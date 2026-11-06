import type { TeamConversation, TeamMessage, TeamReaction } from "@t3tools/contracts";

import { markdownToPlainText } from "./messageMarkdown";

export const MAX_MESSAGES_PER_CONVERSATION = 500;
export const MESSAGE_PAGE_SIZE = 50;

const MESSAGE_COUNTER_THRESHOLD = 0.9;
const NUMERIC_ID = /^\d+$/;

/** Ids are numeric strings that grow with send order; "9" sorts before "10". */
export function compareMessageIds(a: string, b: string): number {
  if (!NUMERIC_ID.test(a) || !NUMERIC_ID.test(b)) return a.localeCompare(b);
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Dedupes by id (the newer copy wins), orders oldest first, and keeps the newest `limit`. */
export function mergeMessages(
  existing: ReadonlyArray<TeamMessage>,
  incoming: ReadonlyArray<TeamMessage>,
  limit: number = MAX_MESSAGES_PER_CONVERSATION,
): ReadonlyArray<TeamMessage> {
  const byId = new Map<string, TeamMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  const sorted = [...byId.values()].sort((a, b) => compareMessageIds(a.id, b.id));
  return sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;
}

/** The peer is the only other sender in a direct conversation. */
export function isIncomingMessage(message: TeamMessage, conversation: TeamConversation): boolean {
  return message.senderId === conversation.peer.id;
}

function conversationRecency(conversation: TeamConversation): number {
  const time = Date.parse(conversation.updatedAt);
  return Number.isNaN(time) ? 0 : time;
}

/** Most recent first. */
export function upsertConversation(
  conversations: ReadonlyArray<TeamConversation>,
  conversation: TeamConversation,
): ReadonlyArray<TeamConversation> {
  return [...conversations.filter((entry) => entry.id !== conversation.id), conversation].sort(
    (a, b) => conversationRecency(b) - conversationRecency(a),
  );
}

export function markConversationRead(
  conversations: ReadonlyArray<TeamConversation>,
  conversationId: string,
): ReadonlyArray<TeamConversation> {
  return conversations.map((entry) =>
    entry.id === conversationId && entry.unreadCount > 0 ? { ...entry, unreadCount: 0 } : entry,
  );
}

export function totalUnread(conversations: ReadonlyArray<TeamConversation>): number {
  return conversations.reduce((sum, entry) => sum + entry.unreadCount, 0);
}

export function previewText(body: string, maxLength = 80): string {
  const flat = markdownToPlainText(body);
  const letters = Array.from(flat);
  return letters.length > maxLength ? `${letters.slice(0, maxLength - 1).join("")}…` : flat;
}

export function unreadLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export interface MessageDayGroup {
  /** Local calendar day, unique per group. */
  readonly key: string;
  /** The first message's time, for labelling the day. */
  readonly startedAt: string;
  readonly messages: ReadonlyArray<TeamMessage>;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function groupMessagesByDay(messages: ReadonlyArray<TeamMessage>): MessageDayGroup[] {
  const groups: Array<{ key: string; startedAt: string; messages: TeamMessage[] }> = [];
  for (const message of messages) {
    const key = localDayKey(new Date(message.createdAt));
    const last = groups.at(-1);
    if (last?.key === key) last.messages.push(message);
    else groups.push({ key, startedAt: message.createdAt, messages: [message] });
  }
  return groups;
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const dayWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function dayLabel(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  const key = localDayKey(date);
  if (key === localDayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDayKey(yesterday)) return "Yesterday";
  return (date.getFullYear() === now.getFullYear() ? dayFormatter : dayWithYearFormatter).format(
    date,
  );
}

/** The counter shows once the draft is close to or past the limit. */
export function showsMessageCounter(length: number, limit: number): boolean {
  return length >= limit * MESSAGE_COUNTER_THRESHOLD;
}

/** Hands each `data:` line to `onData` as it completes; comments and other fields are ignored. */
export function createSseParser(onData: (data: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\n|\r/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice("data:".length);
      onData(value.startsWith(" ") ? value.slice(1) : value);
    }
  };
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

/** The conversation id in `/messages/:id`, or null. */
export function openConversationId(pathname: string): string | null {
  const match = /^\/messages\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

const GITHUB_PULL_PATH = /^\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:\/|$)/;

/** The repository and number of a GitHub pull request URL, or null for any other URL. */
export function parsePullRequestUrl(url: string): { repository: string; number: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const pull = GITHUB_PULL_PATH.exec(parsed.pathname);
  return pull?.[1] && pull[2] ? { repository: pull[1], number: Number(pull[2]) } : null;
}

const RUN_GAP_MS = 5 * 60_000;

/** A message opens a new run (name and avatar shown) after another sender or a pause of five minutes. */
export function startsMessageRun(
  previous: { readonly senderId: string; readonly createdAt: string } | undefined,
  message: { readonly senderId: string; readonly createdAt: string },
): boolean {
  if (previous === undefined || previous.senderId !== message.senderId) return true;
  return Date.parse(message.createdAt) - Date.parse(previous.createdAt) > RUN_GAP_MS;
}

const DELETED_MESSAGE_PREVIEW = "Message deleted";
const REPLY_PREVIEW_LENGTH = 120;
const REPLY_BODY_LENGTH = 200;

/** One line for notifications of a message; a deleted one says so. */
export function messagePreview(message: TeamMessage, maxLength = 80): string {
  return message.deleted ? DELETED_MESSAGE_PREVIEW : previewText(message.body, maxLength);
}

/** What a reply quote or the composer's "replying to" strip shows of the original. */
export function replySnippet(original: {
  readonly body: string;
  readonly deleted: boolean;
}): string {
  return original.deleted
    ? "Original message was deleted"
    : previewText(original.body, REPLY_PREVIEW_LENGTH);
}

/** Only your own messages that still exist can be edited or deleted. */
export function isOwnLiveMessage(message: TeamMessage, selfId: string): boolean {
  return !message.deleted && message.senderId === selfId;
}

/** Adds or removes one person's reaction; an emoji nobody uses disappears. */
export function applyReaction(
  reactions: ReadonlyArray<TeamReaction>,
  emoji: string,
  userId: string,
  on: boolean,
): ReadonlyArray<TeamReaction> {
  const current = reactions.find((reaction) => reaction.emoji === emoji);
  if (on) {
    if (current === undefined) return [...reactions, { emoji, userIds: [userId] }];
    if (current.userIds.includes(userId)) return reactions;
    return reactions.map((reaction) =>
      reaction === current ? { emoji, userIds: [...reaction.userIds, userId] } : reaction,
    );
  }
  if (current === undefined || !current.userIds.includes(userId)) return reactions;
  const rest = current.userIds.filter((id) => id !== userId);
  return rest.length === 0
    ? reactions.filter((reaction) => reaction !== current)
    : reactions.map((reaction) => (reaction === current ? { emoji, userIds: rest } : reaction));
}

/** "You, Ada Demo": you first, then the others in the order they reacted. */
export function reactionWho(
  userIds: ReadonlyArray<string>,
  selfId: string,
  names: Readonly<Record<string, string>>,
): string {
  const others = userIds.filter((id) => id !== selfId).map((id) => names[id] ?? "Someone");
  return (userIds.includes(selfId) ? ["You", ...others] : others).join(", ");
}

/**
 * Swaps in the new state of a loaded message and refreshes the quotes of loaded replies to it.
 * A message that is not loaded stays out: adding it would leave a gap in the thread.
 */
export function applyMessageUpdate(
  messages: ReadonlyArray<TeamMessage>,
  updated: TeamMessage,
): ReadonlyArray<TeamMessage> {
  if (!messages.some((message) => message.id === updated.id)) return messages;
  return messages.map((message) => {
    if (message.id === updated.id) return updated;
    const quote = message.replyTo;
    if (quote?.id !== updated.id) return message;
    return {
      ...message,
      replyTo: {
        ...quote,
        body: updated.deleted ? "" : updated.body.slice(0, REPLY_BODY_LENGTH),
        deleted: updated.deleted,
      },
    };
  });
}

export type JumpStep = "found" | "load-earlier" | "give-up";

/** Whether a reply's original is loaded, worth loading earlier pages for, or out of reach. */
export function nextJumpStep(
  loadedIds: ReadonlyArray<string>,
  hasMore: boolean,
  targetId: string,
  cap: number = MAX_MESSAGES_PER_CONVERSATION,
): JumpStep {
  if (loadedIds.includes(targetId)) return "found";
  const oldest = loadedIds[0];
  if (!hasMore || oldest === undefined || loadedIds.length >= cap) return "give-up";
  // Newer than the oldest loaded message yet absent: earlier pages will never contain it.
  return compareMessageIds(targetId, oldest) > 0 ? "give-up" : "load-earlier";
}
