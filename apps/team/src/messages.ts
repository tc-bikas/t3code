import {
  TEAM_EMOJI_MAX_LENGTH,
  TEAM_MESSAGE_MAX_LENGTH,
  type TeamConversation,
  type TeamMessage,
  type TeamMessagesResult,
  type TeamPerson,
} from "@t3tools/contracts";
import { iso, nowIso, type TeamContext, type UserRow } from "./context.ts";
import type { Queryable } from "./db.ts";
import { TeamError } from "./errors.ts";
import { consume } from "./rateLimit.ts";

const SEND_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const REACTION_LIMIT = { limit: 60, windowMs: 60 * 1000 };
const REPLY_PREVIEW_MAX_LENGTH = 200;
const MAX_EMOJIS_PER_MESSAGE = 20;
const SEARCH_MAX_RESULTS = 10;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_ID = /^[0-9]{1,18}$/;
const notFound = () => new TeamError("not-found", "Not found.");

interface PersonRow {
  id: string;
  name: string;
  github_login: string;
  avatar_url: string | null;
}

const toPerson = (row: PersonRow): TeamPerson => ({
  id: row.id,
  name: row.name,
  githubLogin: row.github_login,
  avatarUrl: row.avatar_url,
});

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: Date | string;
  edited_at: Date | string | null;
  deleted_at: Date | string | null;
  reply_id: string | null;
  reply_sender_id: string | null;
  reply_body: string | null;
  reply_deleted_at: Date | string | null;
}

/** Messages with their quoted original joined in, so previews cost no extra query. */
const MESSAGE_SELECT = `
  SELECT m.id::text AS id, m.conversation_id::text AS conversation_id, m.sender_id, m.body,
         m.created_at, m.edited_at, m.deleted_at,
         r.id::text AS reply_id, r.sender_id AS reply_sender_id, r.body AS reply_body,
         r.deleted_at AS reply_deleted_at
    FROM messages m LEFT JOIN messages r ON r.id = m.reply_to_id`;

/** Reactions of many messages in one query, in the order they were made. */
async function loadReactions(
  q: Queryable,
  messageIds: ReadonlyArray<string>,
): Promise<Map<string, Array<{ emoji: string; userIds: string[] }>>> {
  const byMessage = new Map<string, Array<{ emoji: string; userIds: string[] }>>();
  if (messageIds.length === 0) return byMessage;
  const rows = await q.query<{ message_id: string; user_id: string; emoji: string }>(
    `SELECT message_id::text AS message_id, user_id, emoji FROM message_reactions
      WHERE message_id = ANY($1::bigint[]) ORDER BY seq`,
    [messageIds],
  );
  for (const row of rows) {
    const reactions = byMessage.get(row.message_id) ?? [];
    byMessage.set(row.message_id, reactions);
    const existing = reactions.find((reaction) => reaction.emoji === row.emoji);
    if (existing) existing.userIds.push(row.user_id);
    else reactions.push({ emoji: row.emoji, userIds: [row.user_id] });
  }
  return byMessage;
}

async function hydrate(q: Queryable, rows: ReadonlyArray<MessageRow>): Promise<TeamMessage[]> {
  const reactions = await loadReactions(
    q,
    rows.filter((row) => row.deleted_at === null).map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.deleted_at === null ? row.body : "",
    createdAt: iso(row.created_at),
    editedAt: row.edited_at === null ? null : iso(row.edited_at),
    deleted: row.deleted_at !== null,
    replyTo:
      row.reply_id !== null && row.reply_sender_id !== null
        ? {
            id: row.reply_id,
            senderId: row.reply_sender_id,
            body:
              row.reply_deleted_at === null
                ? (row.reply_body ?? "").slice(0, REPLY_PREVIEW_MAX_LENGTH)
                : "",
            deleted: row.reply_deleted_at !== null,
          }
        : null,
    reactions: reactions.get(row.id) ?? [],
  }));
}

async function loadMessages(
  q: Queryable,
  ids: ReadonlyArray<string>,
): Promise<Map<string, TeamMessage>> {
  if (ids.length === 0) return new Map();
  const rows = await q.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ANY($1::bigint[])`, [ids]);
  return new Map((await hydrate(q, rows)).map((message) => [message.id, message]));
}

export async function searchUsers(
  ctx: TeamContext,
  user: UserRow,
  rawQuery: string,
): Promise<TeamPerson[]> {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 2 || q.length > 50) return [];
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await ctx.db.query<PersonRow>(
    `SELECT id, name, github_login, avatar_url FROM users
      WHERE id <> $1 AND (lower(github_login) LIKE $2 OR lower(name) LIKE $2)
      ORDER BY lower(github_login), github_login
      LIMIT ${SEARCH_MAX_RESULTS}`,
    [user.id, pattern],
  );
  return rows.map(toPerson);
}

/** Conversations as `userId` sees them, newest activity first; `conversationId` narrows to one. */
async function conversationsFor(
  q: Queryable,
  userId: string,
  conversationId?: string,
): Promise<TeamConversation[]> {
  const rows = await q.query<
    PersonRow & {
      conversation_id: string;
      updated_at: Date | string;
      unread: number;
      m_id: string | null;
    }
  >(
    `SELECT c.id::text AS conversation_id, c.updated_at,
            p.id, p.name, p.github_login, p.avatar_url, m.id::text AS m_id,
            (SELECT count(*)::int FROM messages x
              WHERE x.conversation_id = c.id AND x.sender_id <> $1 AND x.deleted_at IS NULL
                AND x.id > COALESCE((SELECT r.last_read_message_id FROM conversation_reads r
                                      WHERE r.conversation_id = c.id AND r.user_id = $1), 0)) AS unread
       FROM conversations c
       JOIN users p ON p.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
       LEFT JOIN LATERAL (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) m ON true
      WHERE (c.user_a = $1 OR c.user_b = $1) AND ($2::uuid IS NULL OR c.id = $2::uuid)
      ORDER BY c.updated_at DESC, c.id`,
    [userId, conversationId ?? null],
  );
  const last = await loadMessages(
    q,
    rows.flatMap((row) => (row.m_id === null ? [] : [row.m_id])),
  );
  return rows.map((row) => ({
    id: row.conversation_id,
    peer: toPerson(row),
    lastMessage: row.m_id === null ? null : (last.get(row.m_id) ?? null),
    unreadCount: row.unread,
    updatedAt: iso(row.updated_at),
  }));
}

export const listConversations = (ctx: TeamContext, user: UserRow) =>
  conversationsFor(ctx.db, user.id);

export async function startConversation(
  ctx: TeamContext,
  user: UserRow,
  peerId: string,
): Promise<TeamConversation> {
  if (peerId === user.id) {
    throw new TeamError("invalid-input", "You cannot message yourself.");
  }
  const [peer] = await ctx.db.query("SELECT 1 FROM users WHERE id = $1", [peerId]);
  if (!peer) throw notFound();
  // LEAST/GREATEST keep the pair order consistent with the CHECK under the database collation.
  const now = nowIso(ctx);
  await ctx.db.query(
    `INSERT INTO conversations (id, user_a, user_b, created_at, updated_at)
     VALUES ($1, LEAST($2::text, $3::text), GREATEST($2::text, $3::text), $4, $4)
     ON CONFLICT (user_a, user_b) DO NOTHING`,
    [crypto.randomUUID(), user.id, peerId, now],
  );
  const [row] = await ctx.db.query<{ id: string }>(
    `SELECT id::text AS id FROM conversations
      WHERE user_a = LEAST($1::text, $2::text) AND user_b = GREATEST($1::text, $2::text)`,
    [user.id, peerId],
  );
  const [conversation] = row ? await conversationsFor(ctx.db, user.id, row.id) : [];
  if (!conversation) throw new TeamError("unavailable", "Could not start the conversation.");
  return conversation;
}

/** The other participant, or not-found for anyone outside the conversation. */
async function peerOf(q: Queryable, userId: string, conversationId: string): Promise<string> {
  if (!UUID.test(conversationId)) throw notFound();
  const [row] = await q.query<{ user_a: string; user_b: string }>(
    "SELECT user_a, user_b FROM conversations WHERE id = $1::uuid AND (user_a = $2 OR user_b = $2)",
    [conversationId, userId],
  );
  if (!row) throw notFound();
  return row.user_a === userId ? row.user_b : row.user_a;
}

export async function listMessages(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  params: { before: string | null; limit: string | null },
): Promise<TeamMessagesResult> {
  await peerOf(ctx.db, user.id, conversationId);
  const { before, limit: rawLimit } = params;
  if (before !== null && !MESSAGE_ID.test(before)) {
    throw new TeamError("invalid-input", "before must be a message id.");
  }
  const limit = rawLimit === null ? DEFAULT_PAGE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw new TeamError("invalid-input", `limit must be between 1 and ${MAX_PAGE}.`);
  }
  const rows = await ctx.db.query<MessageRow>(
    `${MESSAGE_SELECT}
      WHERE m.conversation_id = $1::uuid AND ($2::bigint IS NULL OR m.id < $2::bigint)
      ORDER BY m.id DESC LIMIT ${limit + 1}`,
    [conversationId, before],
  );
  return {
    messages: await hydrate(ctx.db, rows.slice(0, limit).reverse()),
    hasMore: rows.length > limit,
  };
}

function cleanBody(rawBody: string): string {
  const body = rawBody.trim();
  if (!body) throw new TeamError("invalid-input", "A message cannot be empty.");
  if (body.length > TEAM_MESSAGE_MAX_LENGTH) {
    throw new TeamError("invalid-input", "That message is too long.");
  }
  return body;
}

export async function sendMessage(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  rawBody: string,
  replyToId?: string,
): Promise<TeamMessage> {
  consume(ctx.limiter, `message:${user.id}`, SEND_LIMIT, "You are sending messages too quickly.");
  const body = cleanBody(rawBody);
  const { message, peerId } = await ctx.db.transaction(async (tx) => {
    const peerId = await peerOf(tx, user.id, conversationId);
    if (replyToId !== undefined) {
      const quoted = MESSAGE_ID.test(replyToId)
        ? await tx.query(
            "SELECT 1 FROM messages WHERE id = $1::bigint AND conversation_id = $2::uuid",
            [replyToId, conversationId],
          )
        : [];
      if (quoted.length === 0) {
        throw new TeamError("invalid-input", "replyToId must be a message of this conversation.");
      }
    }
    const now = nowIso(ctx);
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, body, created_at, reply_to_id)
       VALUES ($1::uuid, $2, $3, $4, $5::bigint) RETURNING id::text AS id`,
      [conversationId, user.id, body, now, replyToId ?? null],
    );
    const message = row ? (await loadMessages(tx, [row.id])).get(row.id) : undefined;
    if (!message) throw new TeamError("unavailable", "Could not send the message.");
    await tx.query("UPDATE conversations SET updated_at = $2 WHERE id = $1::uuid", [
      conversationId,
      now,
    ]);
    return { message, peerId };
  });
  for (const recipient of [user.id, peerId]) {
    const [conversation] = await conversationsFor(ctx.db, recipient, conversationId);
    if (conversation) ctx.events.publish(recipient, { type: "message", message, conversation });
  }
  ctx.afterMessage?.({
    conversationId,
    messageId: message.id,
    senderId: user.id,
    recipientId: peerId,
  });
  return message;
}

/** Moves the caller's read marker forward only, and only to a message of this conversation. */
export async function markRead(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  upToMessageId: string,
): Promise<void> {
  await peerOf(ctx.db, user.id, conversationId);
  if (!MESSAGE_ID.test(upToMessageId)) {
    throw new TeamError("invalid-input", "upToMessageId must be a message id.");
  }
  const marked = await ctx.db.query(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id)
     SELECT conversation_id, $2, id FROM messages WHERE id = $3::bigint AND conversation_id = $1::uuid
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_message_id = GREATEST(conversation_reads.last_read_message_id, excluded.last_read_message_id)
     RETURNING 1`,
    [conversationId, user.id, upToMessageId],
  );
  if (marked.length > 0) ctx.events.publish(user.id, { type: "read", conversationId });
}

/** A pictographic, regional-indicator or keycap code point, with no whitespace or control characters. */
const EMOJI_CONTENT = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u;
const EMOJI_FORBIDDEN = /[\s\p{Cc}]/u;

function validateEmoji(emoji: string): void {
  if (
    emoji.length === 0 ||
    emoji.length > TEAM_EMOJI_MAX_LENGTH ||
    EMOJI_FORBIDDEN.test(emoji) ||
    !EMOJI_CONTENT.test(emoji)
  ) {
    throw new TeamError("invalid-input", "That is not a valid emoji.");
  }
}

/** Runs `change` on one message of the conversation; it reports whether anything changed. */
async function changeMessage(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  messageId: string,
  change: (
    tx: Queryable,
    message: { sender_id: string; deleted_at: Date | string | null },
  ) => Promise<boolean>,
): Promise<TeamMessage> {
  const { message, peerId, changed } = await ctx.db.transaction(async (tx) => {
    const peerId = await peerOf(tx, user.id, conversationId);
    if (!MESSAGE_ID.test(messageId)) throw notFound();
    const [row] = await tx.query<{ sender_id: string; deleted_at: Date | string | null }>(
      `SELECT sender_id, deleted_at FROM messages
        WHERE id = $1::bigint AND conversation_id = $2::uuid FOR UPDATE`,
      [messageId, conversationId],
    );
    if (!row) throw notFound();
    const changed = await change(tx, row);
    const message = (await loadMessages(tx, [messageId])).get(messageId);
    if (!message) throw notFound();
    return { message, peerId, changed };
  });
  if (changed) {
    for (const recipient of [user.id, peerId]) {
      const [conversation] = await conversationsFor(ctx.db, recipient, conversationId);
      if (conversation) {
        ctx.events.publish(recipient, { type: "message-updated", message, conversation });
      }
    }
  }
  return message;
}

const onlySender = (user: UserRow, message: { sender_id: string }) => {
  if (message.sender_id !== user.id) {
    throw new TeamError("forbidden", "You can only change your own messages.");
  }
};

export async function editMessage(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  messageId: string,
  rawBody: string,
): Promise<TeamMessage> {
  consume(ctx.limiter, `message:${user.id}`, SEND_LIMIT, "You are sending messages too quickly.");
  const body = cleanBody(rawBody);
  return changeMessage(ctx, user, conversationId, messageId, async (tx, message) => {
    onlySender(user, message);
    if (message.deleted_at !== null) {
      throw new TeamError("invalid-input", "A deleted message cannot be edited.");
    }
    await tx.query("UPDATE messages SET body = $2, edited_at = $3 WHERE id = $1::bigint", [
      messageId,
      body,
      nowIso(ctx),
    ]);
    return true;
  });
}

/** Soft delete: the row stays so replies, ordering and read markers keep working. */
export function deleteMessage(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  messageId: string,
): Promise<TeamMessage> {
  return changeMessage(ctx, user, conversationId, messageId, async (tx, message) => {
    onlySender(user, message);
    if (message.deleted_at !== null) return false;
    await tx.query("UPDATE messages SET body = '', deleted_at = $2 WHERE id = $1::bigint", [
      messageId,
      nowIso(ctx),
    ]);
    await tx.query("DELETE FROM message_reactions WHERE message_id = $1::bigint", [messageId]);
    return true;
  });
}

export function addReaction(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<TeamMessage> {
  consume(ctx.limiter, `reaction:${user.id}`, REACTION_LIMIT, "You are reacting too quickly.");
  validateEmoji(emoji);
  return changeMessage(ctx, user, conversationId, messageId, async (tx, message) => {
    if (message.deleted_at !== null) {
      throw new TeamError("invalid-input", "You cannot react to a deleted message.");
    }
    const [used] = await tx.query<{ distinct_count: number; has_emoji: boolean }>(
      `SELECT count(DISTINCT emoji)::int AS distinct_count,
              COALESCE(bool_or(emoji = $2), false) AS has_emoji
         FROM message_reactions WHERE message_id = $1::bigint`,
      [messageId, emoji],
    );
    if (used && !used.has_emoji && used.distinct_count >= MAX_EMOJIS_PER_MESSAGE) {
      throw new TeamError("invalid-input", "That message has too many different reactions.");
    }
    const added = await tx.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
       VALUES ($1::bigint, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING 1`,
      [messageId, user.id, emoji, nowIso(ctx)],
    );
    return added.length > 0;
  });
}

export function removeReaction(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<TeamMessage> {
  consume(ctx.limiter, `reaction:${user.id}`, REACTION_LIMIT, "You are reacting too quickly.");
  return changeMessage(ctx, user, conversationId, messageId, async (tx) => {
    const removed = await tx.query(
      `DELETE FROM message_reactions
        WHERE message_id = $1::bigint AND user_id = $2 AND emoji = $3 RETURNING 1`,
      [messageId, user.id, emoji],
    );
    return removed.length > 0;
  });
}
