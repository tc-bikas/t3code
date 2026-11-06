import type { TeamConversation, TeamEvent, TeamMessage } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { writeTeamToken } from "./teamStore";
import { isTeamError, teamApi } from "./teamClient";
import {
  applyMessageUpdate,
  applyReaction,
  compareMessageIds,
  markConversationRead,
  MAX_MESSAGES_PER_CONVERSATION,
  mergeMessages,
  MESSAGE_PAGE_SIZE,
  nextJumpStep,
  totalUnread,
  upsertConversation,
} from "./messages.logic";

export interface PendingMessage {
  readonly localId: string;
  readonly body: string;
  readonly replyToId: string | null;
  readonly status: "sending" | "failed";
  readonly error: string | null;
}

export interface ThreadState {
  readonly status: "loading" | "ready" | "failed";
  readonly error: string | null;
  /** Oldest first. */
  readonly messages: ReadonlyArray<TeamMessage>;
  readonly hasMore: boolean;
  readonly loadingEarlier: boolean;
  readonly pending: ReadonlyArray<PendingMessage>;
}

export interface MessagesState {
  readonly listStatus: "loading" | "ready" | "failed";
  readonly listError: string | null;
  readonly conversations: ReadonlyArray<TeamConversation>;
  readonly threads: Readonly<Record<string, ThreadState>>;
}

export interface MessagesScope {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly serverUrl: string;
  readonly token: string;
}

const INITIAL: MessagesState = {
  listStatus: "loading",
  listError: null,
  conversations: [],
  threads: {},
};

const EMPTY_THREAD: ThreadState = {
  status: "loading",
  error: null,
  messages: [],
  hasMore: false,
  loadingEarlier: false,
  pending: [],
};

const stateKey = (serverUrl: string, token: string | null) => JSON.stringify([serverUrl, token]);

const messagesAtom = Atom.family((key: string) =>
  Atom.make<MessagesState>(INITIAL).pipe(Atom.keepAlive, Atom.withLabel(`team:messages:${key}`)),
);

export const messagesAtomFor = (serverUrl: string, token: string | null) =>
  messagesAtom(stateKey(serverUrl, token));

const unreadAtom = Atom.family((key: string) =>
  Atom.map(messagesAtom(key), (state) => totalUnread(state.conversations)),
);

export const unreadAtomFor = (serverUrl: string, token: string | null) =>
  unreadAtom(stateKey(serverUrl, token));

const apiFor = ({ serverUrl, token }: MessagesScope) =>
  teamApi(serverUrl, token, () => writeTeamToken(serverUrl, null));

const failureMessage = (error: unknown, serverUrl: string): string =>
  isTeamError(error) ? error.message : `Something went wrong talking to ${serverUrl}.`;

const read = (scope: MessagesScope) =>
  scope.registry.get(messagesAtomFor(scope.serverUrl, scope.token));

const update = (scope: MessagesScope, change: (state: MessagesState) => MessagesState) => {
  const atom = messagesAtomFor(scope.serverUrl, scope.token);
  scope.registry.set(atom, change(scope.registry.get(atom)));
};

const updateThread = (
  scope: MessagesScope,
  conversationId: string,
  change: (thread: ThreadState) => ThreadState,
) =>
  update(scope, (state) => ({
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: change(state.threads[conversationId] ?? EMPTY_THREAD),
    },
  }));

const listReads = new Map<string, Promise<void>>();

/** Calls made while a read is in flight share it. */
export function loadConversations(scope: MessagesScope): Promise<void> {
  const key = stateKey(scope.serverUrl, scope.token);
  const running = listReads.get(key);
  if (running !== undefined) return running;
  const read = fetchConversations(scope).finally(() => listReads.delete(key));
  listReads.set(key, read);
  return read;
}

async function fetchConversations(scope: MessagesScope): Promise<void> {
  const result = await apiFor(scope)
    .conversations()
    .then(
      ({ conversations }) => ({ conversations }),
      (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
    );
  update(scope, (state) =>
    "conversations" in result
      ? {
          ...state,
          listStatus: "ready",
          listError: null,
          conversations: [...result.conversations],
        }
      : state.listStatus === "ready"
        ? state
        : { ...state, listStatus: "failed", listError: result.error },
  );
}

/** Reads the newest page. A thread already on screen keeps its older messages and merges. */
async function loadThread(scope: MessagesScope, conversationId: string): Promise<void> {
  updateThread(scope, conversationId, (thread) => ({
    ...thread,
    status: thread.status === "ready" ? "ready" : "loading",
    error: null,
  }));
  const result = await apiFor(scope)
    .messages(conversationId, { limit: MESSAGE_PAGE_SIZE })
    .then(
      (page) => page,
      (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
    );
  updateThread(scope, conversationId, (thread) =>
    "error" in result
      ? thread.status === "ready"
        ? thread
        : { ...thread, status: "failed", error: result.error }
      : {
          ...thread,
          status: "ready",
          error: null,
          messages: mergeMessages(thread.messages, result.messages),
          hasMore: thread.messages.length === 0 ? result.hasMore : thread.hasMore,
        },
  );
}

/** Opening a thread loads it once; a failed one is retried. */
export function ensureThread(scope: MessagesScope, conversationId: string): void {
  const thread = read(scope).threads[conversationId];
  if (thread === undefined || thread.status === "failed") void loadThread(scope, conversationId);
}

/** Reconnects refresh what is already loaded, so nothing sent while offline is missed. */
export function refreshLoadedThreads(scope: MessagesScope): void {
  for (const [id, thread] of Object.entries(read(scope).threads)) {
    if (thread.status === "ready") void loadThread(scope, id);
  }
}

export async function loadEarlier(scope: MessagesScope, conversationId: string): Promise<void> {
  const thread = read(scope).threads[conversationId];
  const oldest = thread?.messages[0];
  if (thread === undefined || oldest === undefined || thread.loadingEarlier || !thread.hasMore) {
    return;
  }
  updateThread(scope, conversationId, (current) => ({
    ...current,
    loadingEarlier: true,
    error: null,
  }));
  const result = await apiFor(scope)
    .messages(conversationId, { before: oldest.id, limit: MESSAGE_PAGE_SIZE })
    .then(
      (page) => page,
      (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
    );
  updateThread(scope, conversationId, (current) =>
    "error" in result
      ? { ...current, loadingEarlier: false, error: result.error }
      : {
          ...current,
          loadingEarlier: false,
          messages: mergeMessages(
            current.messages,
            result.messages,
            MAX_MESSAGES_PER_CONVERSATION + MESSAGE_PAGE_SIZE,
          ),
          hasMore: result.hasMore,
        },
  );
}

/** Newest known message of a conversation, whether loaded or only seen as its preview. */
function newestKnownMessageId(state: MessagesState, conversationId: string): string | null {
  const loaded = state.threads[conversationId]?.messages.at(-1)?.id ?? null;
  const preview =
    state.conversations.find((entry) => entry.id === conversationId)?.lastMessage?.id ?? null;
  if (loaded === null || preview === null) return loaded ?? preview;
  return compareMessageIds(loaded, preview) >= 0 ? loaded : preview;
}

const MARK_READ_DEBOUNCE_MS = 400;
const markReadTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced, and a no-op when nothing is unread. Call from handlers and the coordinator only. */
export function scheduleMarkRead(scope: MessagesScope, conversationId: string): void {
  const key = `${stateKey(scope.serverUrl, scope.token)}:${conversationId}`;
  clearTimeout(markReadTimers.get(key));
  markReadTimers.set(
    key,
    setTimeout(() => {
      markReadTimers.delete(key);
      const state = read(scope);
      const conversation = state.conversations.find((entry) => entry.id === conversationId);
      const upTo = newestKnownMessageId(state, conversationId);
      if (conversation === undefined || conversation.unreadCount === 0 || upTo === null) return;
      update(scope, (current) => ({
        ...current,
        conversations: markConversationRead(current.conversations, conversationId),
      }));
      void apiFor(scope)
        .markRead(conversationId, upTo)
        .catch(() => undefined);
    }, MARK_READ_DEBOUNCE_MS),
  );
}

function cancelMarkReads(scope: MessagesScope): void {
  const prefix = `${stateKey(scope.serverUrl, scope.token)}:`;
  for (const [key, timer] of markReadTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    markReadTimers.delete(key);
  }
}

export function publishConversation(scope: MessagesScope, conversation: TeamConversation): void {
  update(scope, (state) => ({
    ...state,
    conversations: upsertConversation(state.conversations, conversation),
  }));
}

/**
 * Puts the server's state of an edited, deleted or reacted-to message into its loaded thread.
 * A carried conversation is the receiver's view and wins; otherwise a matching preview follows.
 */
function commitMessage(
  scope: MessagesScope,
  message: TeamMessage,
  carried?: TeamConversation,
): void {
  update(scope, (state) => {
    const thread = state.threads[message.conversationId];
    return {
      ...state,
      conversations:
        carried !== undefined
          ? upsertConversation(state.conversations, carried)
          : state.conversations.map((conversation) =>
              conversation.id === message.conversationId &&
              conversation.lastMessage?.id === message.id
                ? { ...conversation, lastMessage: message }
                : conversation,
            ),
      threads:
        thread === undefined
          ? state.threads
          : {
              ...state.threads,
              [message.conversationId]: {
                ...thread,
                messages: applyMessageUpdate(thread.messages, message),
              },
            },
    };
  });
}

export function applyTeamEvent(scope: MessagesScope, event: TeamEvent): void {
  if (event.type === "message-updated") {
    commitMessage(scope, event.message, event.conversation);
    return;
  }
  if (event.type === "read") {
    update(scope, (state) => ({
      ...state,
      conversations: markConversationRead(state.conversations, event.conversationId),
    }));
    return;
  }
  update(scope, (state) => {
    const thread = state.threads[event.message.conversationId];
    return {
      ...state,
      conversations: upsertConversation(state.conversations, event.conversation),
      threads:
        thread === undefined
          ? state.threads
          : {
              ...state.threads,
              [event.message.conversationId]: {
                ...thread,
                messages: mergeMessages(thread.messages, [event.message]),
              },
            },
    };
  });
}

let nextLocalId = 0;

/** Shows the message at once; it settles when the server answers, or stays to retry. */
export async function sendMessage(
  scope: MessagesScope,
  conversationId: string,
  body: string,
  replyToId: string | null = null,
): Promise<void> {
  const localId = `local-${++nextLocalId}`;
  await deliver(scope, conversationId, {
    localId,
    body,
    replyToId,
    status: "sending",
    error: null,
  });
}

export function retryMessage(scope: MessagesScope, conversationId: string, localId: string) {
  const pending = read(scope).threads[conversationId]?.pending.find(
    (entry) => entry.localId === localId,
  );
  if (pending === undefined || pending.status === "sending") return Promise.resolve();
  return deliver(scope, conversationId, { ...pending, status: "sending", error: null });
}

export function discardMessage(scope: MessagesScope, conversationId: string, localId: string) {
  updateThread(scope, conversationId, (thread) => ({
    ...thread,
    pending: thread.pending.filter((entry) => entry.localId !== localId),
  }));
}

async function deliver(scope: MessagesScope, conversationId: string, entry: PendingMessage) {
  updateThread(scope, conversationId, (thread) => ({
    ...thread,
    pending: [...thread.pending.filter((other) => other.localId !== entry.localId), entry],
  }));
  const result = await apiFor(scope)
    .sendMessage(conversationId, {
      body: entry.body,
      ...(entry.replyToId === null ? {} : { replyToId: entry.replyToId }),
    })
    .then(
      (message) => ({ message }),
      (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
    );
  update(scope, (state) => {
    const thread = state.threads[conversationId] ?? EMPTY_THREAD;
    const others = thread.pending.filter((other) => other.localId !== entry.localId);
    if ("error" in result) {
      return {
        ...state,
        threads: {
          ...state.threads,
          [conversationId]: {
            ...thread,
            pending: [...others, { ...entry, status: "failed" as const, error: result.error }],
          },
        },
      };
    }
    const existing = state.conversations.find((conversation) => conversation.id === conversationId);
    return {
      ...state,
      conversations:
        existing === undefined
          ? state.conversations
          : upsertConversation(state.conversations, {
              ...existing,
              lastMessage: result.message,
              updatedAt: result.message.createdAt,
            }),
      threads: {
        ...state.threads,
        [conversationId]: {
          ...thread,
          pending: others,
          messages: mergeMessages(thread.messages, [result.message]),
        },
      },
    };
  });
}

const patchMessage = (
  scope: MessagesScope,
  conversationId: string,
  messageId: string,
  change: (message: TeamMessage) => TeamMessage,
) =>
  updateThread(scope, conversationId, (thread) => ({
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId ? change(message) : message,
    ),
  }));

const reactionsInFlight = new Map<string, number>();

/**
 * Shows the reaction at once, then settles on the server's state. Resolves to a readable
 * error after undoing the change, or null.
 */
export async function setReaction(
  scope: MessagesScope,
  conversationId: string,
  messageId: string,
  emoji: string,
  userId: string,
  on: boolean,
): Promise<string | null> {
  const key = `${stateKey(scope.serverUrl, scope.token)}:${conversationId}:${messageId}`;
  const apply = (value: boolean) =>
    patchMessage(scope, conversationId, messageId, (message) => ({
      ...message,
      reactions: applyReaction(message.reactions, emoji, userId, value),
    }));
  apply(on);
  reactionsInFlight.set(key, (reactionsInFlight.get(key) ?? 0) + 1);
  const api = apiFor(scope);
  const result = await (
    on
      ? api.addReaction(conversationId, messageId, { emoji })
      : api.removeReaction(conversationId, messageId, emoji)
  ).then(
    (message) => ({ message }),
    (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
  );
  const remaining = (reactionsInFlight.get(key) ?? 1) - 1;
  if (remaining === 0) reactionsInFlight.delete(key);
  else reactionsInFlight.set(key, remaining);
  if ("error" in result) {
    apply(!on);
    return result.error;
  }
  // While more taps are in flight this answer is already stale; the last one settles it.
  if (remaining === 0) commitMessage(scope, result.message);
  return null;
}

/** Resolves to a readable error, or null once the server has the new text. */
export async function editMessage(
  scope: MessagesScope,
  conversationId: string,
  messageId: string,
  body: string,
): Promise<string | null> {
  const result = await apiFor(scope)
    .editMessage(conversationId, messageId, { body })
    .then(
      (message) => ({ message }),
      (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
    );
  if ("error" in result) return result.error;
  commitMessage(scope, result.message);
  return null;
}

export async function deleteMessage(
  scope: MessagesScope,
  conversationId: string,
  messageId: string,
): Promise<string | null> {
  const result = await apiFor(scope)
    .deleteMessage(conversationId, messageId)
    .then(
      (message) => ({ message }),
      (error: unknown) => ({ error: failureMessage(error, scope.serverUrl) }),
    );
  if ("error" in result) return result.error;
  commitMessage(scope, result.message);
  return null;
}

const MAX_REVEAL_PAGES = Math.ceil(MAX_MESSAGES_PER_CONVERSATION / MESSAGE_PAGE_SIZE) + 1;

/** Loads earlier pages until the message is in the thread. False when it cannot be reached. */
export async function revealMessage(
  scope: MessagesScope,
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  for (let page = 0; page <= MAX_REVEAL_PAGES; page++) {
    const thread = read(scope).threads[conversationId];
    if (thread === undefined) return false;
    const step = nextJumpStep(
      thread.messages.map((message) => message.id),
      thread.hasMore,
      messageId,
    );
    if (step !== "load-earlier") return step === "found";
    await loadEarlier(scope, conversationId);
    if (read(scope).threads[conversationId]?.error != null) return false;
  }
  return false;
}

export function clearMessages(scope: MessagesScope): void {
  cancelMarkReads(scope);
  scope.registry.set(messagesAtomFor(scope.serverUrl, scope.token), INITIAL);
}
