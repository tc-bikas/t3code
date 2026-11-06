import type { TeamUser } from "@t3tools/contracts";
import type { Db } from "./db.ts";
import type { EmailSender, Mail } from "./email.ts";
import type { RateLimiter } from "./rateLimit.ts";

export interface TeamContext {
  readonly db: Db;
  readonly mail: EmailSender;
  readonly limiter: RateLimiter;
  readonly now: () => number;
  readonly publicUrl: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  email_verified: boolean;
  created_at: Date | string;
}

export const iso = (value: Date | string): string => new Date(value).toISOString();

export const nowIso = (ctx: TeamContext): string => new Date(ctx.now()).toISOString();

export const after = (ctx: TeamContext, ms: number): string =>
  new Date(ctx.now() + ms).toISOString();

export const toTeamUser = (row: UserRow): TeamUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  emailVerified: row.email_verified,
  createdAt: iso(row.created_at),
});

/** Mail never fails a request: the account action already happened and can be retried. */
export async function sendMail(ctx: TeamContext, mail: Mail): Promise<void> {
  try {
    await ctx.mail.send(mail);
  } catch (cause) {
    console.error(
      `[team] could not send "${mail.subject}":`,
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
}

export const devLink = (ctx: TeamContext, link: string): { devLink?: string } =>
  ctx.mail.console ? { devLink: link } : {};
