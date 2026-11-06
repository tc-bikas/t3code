import {
  TeamAuthResult,
  TeamErrorBody,
  TeamErrorCode,
  TeamMailSentResult,
  TeamMe,
  TeamOrganizationDetail,
  TeamInviteResult,
  TeamSessionsResult,
  TeamUser,
  type TeamChangePasswordInput,
  type TeamCreateOrganizationInput,
  type TeamDeleteAccountInput,
  type TeamInviteInput,
  type TeamRole,
  type TeamSignInInput,
  type TeamSignUpInput,
  type TeamUpdateOrganizationInput,
  type TeamUpdateProfileInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

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
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
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

  return {
    signUp: (input: TeamSignUpInput) =>
      request(
        serverUrl,
        "/auth/signup",
        { method: "POST", token: null, body: input },
        TeamAuthResult,
      ),
    signIn: (input: TeamSignInInput) =>
      request(
        serverUrl,
        "/auth/login",
        { method: "POST", token: null, body: input },
        TeamAuthResult,
      ),
    signOut: () => send204("POST", "/auth/logout"),
    resendVerification: () =>
      write("POST", "/auth/resend-verification", undefined, TeamMailSentResult),
    forgotPassword: (email: string) =>
      request(
        serverUrl,
        "/auth/forgot-password",
        { method: "POST", token: null, body: { email } },
        TeamMailSentResult,
      ),
    me: () => get("/me", TeamMe),
    updateProfile: (input: TeamUpdateProfileInput) => write("PATCH", "/me", input, TeamUser),
    changePassword: (input: TeamChangePasswordInput) => send204("POST", "/me/password", input),
    deleteAccount: (input: TeamDeleteAccountInput) => send204("POST", "/me/delete", input),
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
  };
}

export type TeamApi = ReturnType<typeof teamApi>;
