import {
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
}

const MESSAGE_COLUMNS =
  "id::text AS id, conversation_id::text AS conversation_id, sender_id, body, created_at";

const toMessage = (row: MessageRow): TeamMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  body: row.body,
  createdAt: iso(row.created_at),
});

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
      m_sender_id: string | null;
      m_body: string | null;
      m_created_at: Date | string | null;
    }
  >(
    `SELECT c.id::text AS conversation_id, c.updated_at,
            p.id, p.name, p.github_login, p.avatar_url,
            m.id::text AS m_id, m.sender_id AS m_sender_id, m.body AS m_body, m.created_at AS m_created_at,
            (SELECT count(*)::int FROM messages x
              WHERE x.conversation_id = c.id AND x.sender_id <> $1
                AND x.id > COALESCE((SELECT r.last_read_message_id FROM conversation_reads r
                                      WHERE r.conversation_id = c.id AND r.user_id = $1), 0)) AS unread
       FROM conversations c
       JOIN users p ON p.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
       LEFT JOIN LATERAL (SELECT * FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) m ON true
      WHERE (c.user_a = $1 OR c.user_b = $1) AND ($2::uuid IS NULL OR c.id = $2::uuid)
      ORDER BY c.updated_at DESC, c.id`,
    [userId, conversationId ?? null],
  );
  return rows.map((row) => ({
    id: row.conversation_id,
    peer: toPerson(row),
    lastMessage:
      row.m_id !== null &&
      row.m_sender_id !== null &&
      row.m_body !== null &&
      row.m_created_at !== null
        ? toMessage({
            id: row.m_id,
            conversation_id: row.conversation_id,
            sender_id: row.m_sender_id,
            body: row.m_body,
            created_at: row.m_created_at,
          })
        : null,
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
    `SELECT ${MESSAGE_COLUMNS} FROM messages
      WHERE conversation_id = $1::uuid AND ($2::bigint IS NULL OR id < $2::bigint)
      ORDER BY id DESC LIMIT ${limit + 1}`,
    [conversationId, before],
  );
  return {
    messages: rows.slice(0, limit).reverse().map(toMessage),
    hasMore: rows.length > limit,
  };
}

export async function sendMessage(
  ctx: TeamContext,
  user: UserRow,
  conversationId: string,
  rawBody: string,
): Promise<TeamMessage> {
  consume(ctx.limiter, `message:${user.id}`, SEND_LIMIT, "You are sending messages too quickly.");
  const body = rawBody.trim();
  if (!body) throw new TeamError("invalid-input", "A message cannot be empty.");
  if (body.length > TEAM_MESSAGE_MAX_LENGTH) {
    throw new TeamError("invalid-input", "That message is too long.");
  }
  const { message, peerId } = await ctx.db.transaction(async (tx) => {
    const peerId = await peerOf(tx, user.id, conversationId);
    const now = nowIso(ctx);
    const [row] = await tx.query<MessageRow>(
      `INSERT INTO messages (conversation_id, sender_id, body, created_at)
       VALUES ($1::uuid, $2, $3, $4) RETURNING ${MESSAGE_COLUMNS}`,
      [conversationId, user.id, body, now],
    );
    if (!row) throw new TeamError("unavailable", "Could not send the message.");
    await tx.query("UPDATE conversations SET updated_at = $2 WHERE id = $1::uuid", [
      conversationId,
      now,
    ]);
    return { message: toMessage(row), peerId };
  });
  for (const recipient of [user.id, peerId]) {
    const [conversation] = await conversationsFor(ctx.db, recipient, conversationId);
    if (conversation) ctx.events.publish(recipient, { type: "message", message, conversation });
  }
  ctx.afterMessage?.({ conversationId, senderId: user.id, recipientId: peerId });
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
