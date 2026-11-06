import { TeamError } from "./errors.ts";
import { after, nowIso, type TeamContext, type UserRow } from "./context.ts";
import { DAY, newToken, sha256 } from "./tokens.ts";

const SESSION_TTL = 30 * DAY;
const TOUCH_INTERVAL = 60 * 1000;

export interface Authenticated {
  readonly user: UserRow;
  readonly sessionId: string;
}

export async function createSession(
  ctx: TeamContext,
  userId: string,
  label: string | undefined,
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const expiresAt = after(ctx, SESSION_TTL);
  await ctx.db.query("DELETE FROM sessions WHERE expires_at < $1", [nowIso(ctx)]);
  await ctx.db.query(
    "INSERT INTO sessions (id, user_id, token_hash, label, created_at, last_used_at, expires_at) VALUES ($1, $2, $3, $4, $5, $5, $6)",
    [
      crypto.randomUUID(),
      userId,
      sha256(token),
      label?.trim() || "Unknown device",
      nowIso(ctx),
      expiresAt,
    ],
  );
  return { token, expiresAt };
}

export async function authenticate(
  ctx: TeamContext,
  authorization: string | undefined,
): Promise<Authenticated> {
  const token = /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1];
  const denied = new TeamError("unauthorized", "Sign in to continue.");
  if (!token) throw denied;
  const rows = await ctx.db.query<UserRow & { session_id: string; last_used_at: Date | string }>(
    `SELECT u.*, s.id AS session_id, s.last_used_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [sha256(token), nowIso(ctx)],
  );
  const row = rows[0];
  if (!row) throw denied;
  if (ctx.now() - new Date(row.last_used_at).getTime() >= TOUCH_INTERVAL) {
    await ctx.db.query("UPDATE sessions SET last_used_at = $2, expires_at = $3 WHERE id = $1", [
      row.session_id,
      nowIso(ctx),
      after(ctx, SESSION_TTL),
    ]);
  }
  const { session_id: sessionId, last_used_at: _lastUsed, ...user } = row;
  return { user, sessionId };
}
