import * as NodeCrypto from "node:crypto";
import { after, nowIso, type TeamContext } from "./context.ts";
import type { Queryable } from "./db.ts";

export const DAY = 24 * 60 * 60 * 1000;
const TOKEN_TTL = { verify: DAY, reset: 60 * 60 * 1000 } as const;

export type EmailTokenKind = keyof typeof TOKEN_TTL;

export const newToken = (): string => NodeCrypto.randomBytes(32).toString("base64url");

export const sha256 = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");

/** Issues a single-use token and voids the user's earlier unused ones of that kind. */
export async function issueEmailToken(
  ctx: TeamContext,
  userId: string,
  kind: EmailTokenKind,
): Promise<string> {
  const token = newToken();
  await ctx.db.transaction(async (tx) => {
    await tx.query("DELETE FROM email_tokens WHERE user_id = $1 AND kind = $2", [userId, kind]);
    await tx.query(
      "INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)",
      [sha256(token), userId, kind, after(ctx, TOKEN_TTL[kind])],
    );
  });
  return token;
}

/** The user a still-valid token belongs to, without using it up. */
export async function peekEmailToken(
  ctx: TeamContext,
  token: string,
  kind: EmailTokenKind,
): Promise<string | undefined> {
  const rows = await ctx.db.query<{ user_id: string }>(
    "SELECT user_id FROM email_tokens WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3",
    [sha256(token), kind, nowIso(ctx)],
  );
  return rows[0]?.user_id;
}

/** Atomic: of two concurrent uses, exactly one gets the user id. */
export async function consumeEmailToken(
  ctx: TeamContext,
  tx: Queryable,
  token: string,
  kind: EmailTokenKind,
): Promise<string | undefined> {
  const rows = await tx.query<{ user_id: string }>(
    "UPDATE email_tokens SET used_at = $3 WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3 RETURNING user_id",
    [sha256(token), kind, nowIso(ctx)],
  );
  return rows[0]?.user_id;
}
