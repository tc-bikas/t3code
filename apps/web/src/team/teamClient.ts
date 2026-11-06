import {
  TeamAuthConfig,
  TeamConversation,
  TeamConversationsResult,
  TeamErrorBody,
  TeamErrorCode,
  TeamEvent,
  TeamGithubPollResult,
  TeamGithubStartResult,
  TeamMe,
  TeamMessage,
  TeamMessagesResult,
  TeamOrganizationDetail,
  TeamInviteResult,
  TeamSessionsResult,
  TeamUser,
  TeamUserSearchResult,
  type TeamCreateOrganizationInput,
  type TeamEditMessageInput,
  type TeamInviteInput,
  type TeamReactionInput,
  type TeamSendMessageInput,
  type TeamRole,
  type TeamUpdateOrganizationInput,
  type TeamUpdateProfileInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { createSseParser } from "./messages.logic";
import { teamErrorMessage } from "./team.logic";

export class TeamError extends Schema.TaggedError<TeamError>()("TeamError", {
  code: Schema.Literals([...TeamErrorCode.literals, "unreachable", "bad-response"]),
  serverUrl: Schema.String,
  status: Schema.Number,
}) {
  override get message(): string {
    return teamErrorMessage(this.code, this.serverUrl);
  }
}

export const isTeamError = Schema.is(TeamError);

const REQUEST_TIMEOUT_MS = 10_000;
const decodeErrorBody = Schema.decodeUnknownOption(TeamErrorBody);
const HealthResult = Schema.Struct({ ok: Schema.Boolean });

interface TeamRequestInit {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly token: string | null;
  readonly body?: unknown;
}

async function send(serverUrl: string, path: string, init: TeamRequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/v1${path}`, {
      method: init.method,
      headers: {
        ...(init.token === null ? {} : { Authorization: `Bearer ${init.token}` }),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TeamError({ code: "unreachable", serverUrl, status: 0 });
  }
  const payload: unknown = await response.json().catch(() => undefined);
  if (response.ok) return payload;
  const failure = decodeErrorBody(payload);
  if (failure._tag === "Some") {
    throw new TeamError({ code: failure.value.error.code, serverUrl, status: response.status });
  }
  throw new TeamError({
    code: response.status === 401 ? "unauthorized" : "bad-response",
    serverUrl,
    status: response.status,
  });
}

async function request<A, E>(
  serverUrl: string,
  path: string,
  init: TeamRequestInit,
  schema: Schema.Codec<A, E>,
): Promise<A> {
  const payload = await send(serverUrl, path, init);
  const decoded = Schema.decodeUnknownOption(schema)(payload);
  if (decoded._tag === "None") throw new TeamError({ code: "bad-response", serverUrl, status: 0 });
  return decoded.value;
}

export async function checkTeamServerHealth(serverUrl: string): Promise<void> {
  await request(serverUrl, "/health", { method: "GET", token: null }, HealthResult);
}

/** Every call decodes with the contract's schemas. A 401 on a signed-in call drops the token. */
export function teamApi(serverUrl: string, token: string | null, onUnauthorized: () => void) {
  const guard = <A>(call: Promise<A>): Promise<A> =>
    call.catch((error: unknown) => {
      if (token !== null && isTeamError(error) && error.code === "unauthorized") {
        onUnauthorized();
      }
      throw error;
    });
  const get = <A, E>(path: string, schema: Schema.Codec<A, E>) =>
    guard(request(serverUrl, path, { method: "GET", token }, schema));
  const write = <A, E>(
    method: TeamRequestInit["method"],
    path: string,
    body: unknown,
    schema: Schema.Codec<A, E>,
  ) => guard(request(serverUrl, path, { method, token, body }, schema));
  const send204 = (method: TeamRequestInit["method"], path: string, body?: unknown) =>
    guard(send(serverUrl, path, { method, token, body })).then(() => undefined);
  const org = (id: string) => `/orgs/${encodeURIComponent(id)}`;
  const conversation = (id: string) => `/conversations/${encodeURIComponent(id)}`;
  const message = (id: string, messageId: string) =>
    `${conversation(id)}/messages/${encodeURIComponent(messageId)}`;

  return {
    authConfig: () =>
      request(serverUrl, "/auth/config", { method: "GET", token: null }, TeamAuthConfig),
    githubStart: (deviceLabel: string) =>
      request(
        serverUrl,
        "/auth/github/start",
        { method: "POST", token: null, body: { deviceLabel } },
        TeamGithubStartResult,
      ),
    githubPoll: (state: string) =>
      request(
        serverUrl,
        `/auth/github/poll?state=${encodeURIComponent(state)}`,
        { method: "GET", token: null },
        TeamGithubPollResult,
      ),
    signOut: () => send204("POST", "/auth/logout"),
    me: () => get("/me", TeamMe),
    updateProfile: (input: TeamUpdateProfileInput) => write("PATCH", "/me", input, TeamUser),
    deleteAccount: () => send204("DELETE", "/me"),
    sessions: () => get("/me/sessions", TeamSessionsResult),
    revokeSession: (id: string) => send204("DELETE", `/me/sessions/${encodeURIComponent(id)}`),
    createOrganization: (input: TeamCreateOrganizationInput) =>
      write("POST", "/orgs", input, TeamOrganizationDetail),
    organization: (id: string) => get(org(id), TeamOrganizationDetail),
    updateOrganization: (id: string, input: TeamUpdateOrganizationInput) =>
      write("PATCH", org(id), input, TeamOrganizationDetail),
    deleteOrganization: (id: string) => send204("DELETE", org(id)),
    invite: (id: string, input: TeamInviteInput) =>
      write("POST", `${org(id)}/invites`, input, TeamInviteResult),
    revokeInvite: (id: string, inviteId: string) =>
      send204("DELETE", `${org(id)}/invites/${encodeURIComponent(inviteId)}`),
    setMemberRole: (id: string, userId: string, role: TeamRole) =>
      write(
        "PATCH",
        `${org(id)}/members/${encodeURIComponent(userId)}`,
        { role },
        TeamOrganizationDetail,
      ),
    removeMember: (id: string, userId: string) =>
      send204("DELETE", `${org(id)}/members/${encodeURIComponent(userId)}`),
    acceptInvitation: (id: string) =>
      write(
        "POST",
        `/invitations/${encodeURIComponent(id)}/accept`,
        undefined,
        TeamOrganizationDetail,
      ),
    declineInvitation: (id: string) =>
      send204("POST", `/invitations/${encodeURIComponent(id)}/decline`),
    searchUsers: (query: string) =>
      get(`/users/search?q=${encodeURIComponent(query)}`, TeamUserSearchResult),
    conversations: () => get("/conversations", TeamConversationsResult),
    startConversation: (userId: string) =>
      write("POST", "/conversations", { userId }, TeamConversation),
    messages: (conversationId: string, options: { before?: string; limit: number }) =>
      get(
        `${conversation(conversationId)}/messages?limit=${options.limit}${
          options.before === undefined ? "" : `&before=${encodeURIComponent(options.before)}`
        }`,
        TeamMessagesResult,
      ),
    sendMessage: (conversationId: string, input: TeamSendMessageInput) =>
      write("POST", `${conversation(conversationId)}/messages`, input, TeamMessage),
    editMessage: (conversationId: string, messageId: string, input: TeamEditMessageInput) =>
      write("PATCH", message(conversationId, messageId), input, TeamMessage),
    deleteMessage: (conversationId: string, messageId: string) =>
      write("DELETE", message(conversationId, messageId), undefined, TeamMessage),
    addReaction: (conversationId: string, messageId: string, input: TeamReactionInput) =>
      write("PUT", `${message(conversationId, messageId)}/reactions`, input, TeamMessage),
    removeReaction: (conversationId: string, messageId: string, emoji: string) =>
      write(
        "DELETE",
        `${message(conversationId, messageId)}/reactions/${encodeURIComponent(emoji)}`,
        undefined,
        TeamMessage,
      ),
    markRead: (conversationId: string, upToMessageId: string) =>
      send204("POST", `${conversation(conversationId)}/read`, { upToMessageId }),
  };
}

export type TeamApi = ReturnType<typeof teamApi>;

const EVENT_STREAM_IDLE_MS = 70_000;
const decodeEvent = Schema.decodeUnknownOption(TeamEvent);

/**
 * Reads `GET /v1/events` until it ends, errors, or goes quiet for longer than the server's
 * 25 s keep-alive. EventSource cannot send the Authorization header, so this streams with fetch.
 */
export async function streamTeamEvents(
  serverUrl: string,
  token: string,
  signal: AbortSignal,
  handlers: { readonly onOpen: () => void; readonly onEvent: (event: TeamEvent) => void },
): Promise<void> {
  const idle = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(), EVENT_STREAM_IDLE_MS);
  };
  const parse = createSseParser((data) => {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const event = decodeEvent(json);
    if (event._tag === "Some") handlers.onEvent(event.value);
  });
  touch();
  const response = await fetch(`${serverUrl}/v1/events`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal: AbortSignal.any([signal, idle.signal]),
  }).catch(() => null);
  if (response === null || !response.ok || response.body === null) {
    clearTimeout(idleTimer);
    throw new TeamError({
      code:
        response === null
          ? "unreachable"
          : response.status === 401
            ? "unauthorized"
            : "unavailable",
      serverUrl,
      status: response?.status ?? 0,
    });
  }
  handlers.onOpen();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const chunk = await reader.read().catch(() => null);
    if (chunk === null || chunk.done) break;
    touch();
    parse(chunk.value);
  }
  clearTimeout(idleTimer);
}
