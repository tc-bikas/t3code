import type { TeamUser } from "@t3tools/contracts";
import type { Db } from "./db.ts";
import type { GithubClient } from "./github.ts";
import type { RateLimiter } from "./rateLimit.ts";

export interface TeamContext {
  readonly db: Db;
  /** Undefined when GitHub sign-in is not configured. */
  readonly github:
    | { readonly clientId: string; readonly clientSecret: string; readonly client: GithubClient }
    | undefined;
  readonly limiter: RateLimiter;
  readonly now: () => number;
  readonly publicUrl: string;
}

export interface UserRow {
  id: string;
  github_id: number | string;
  github_login: string;
  name: string;
  avatar_url: string | null;
  email: string | null;
  created_at: Date | string;
}

export const iso = (value: Date | string): string => new Date(value).toISOString();

export const nowIso = (ctx: TeamContext): string => new Date(ctx.now()).toISOString();

export const after = (ctx: TeamContext, ms: number): string =>
  new Date(ctx.now() + ms).toISOString();

export const toTeamUser = (row: UserRow): TeamUser => ({
  id: row.id,
  githubLogin: row.github_login,
  name: row.name,
  avatarUrl: row.avatar_url,
  email: row.email,
  createdAt: iso(row.created_at),
});
