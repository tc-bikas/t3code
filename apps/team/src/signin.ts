import * as NodeCrypto from "node:crypto";
import type {
  TeamGithubPollResult,
  TeamGithubStartInput,
  TeamGithubStartResult,
} from "@t3tools/contracts";
import { after, nowIso, toTeamUser, type TeamContext, type UserRow } from "./context.ts";
import type { Queryable } from "./db.ts";
import { emailDomain, isPublicEmailDomain, normalizeEmail } from "./domains.ts";
import { TeamError } from "./errors.ts";
import type { GithubEmail, GithubProfile } from "./github.ts";
import { consume } from "./rateLimit.ts";
import { createSession, type Authenticated } from "./sessions.ts";

const ATTEMPT_TTL = 10 * 60 * 1000;
const MAX_OUTSTANDING_ATTEMPTS = 5_000;
const START_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };
const GITHUB_SCOPE = "read:user user:email";

const callbackUrl = (ctx: TeamContext) => `${ctx.publicUrl}/auth/github/callback`;

export async function startGithubSignIn(
  ctx: TeamContext,
  input: TeamGithubStartInput,
  ip: string,
): Promise<TeamGithubStartResult> {
  if (!ctx.github) throw new TeamError("not-configured", "GitHub sign-in is not configured.");
  consume(ctx.limiter, `github-start:${ip}`, START_LIMIT);
  await ctx.db.query("DELETE FROM github_sign_ins WHERE expires_at < $1", [nowIso(ctx)]);
  const [{ count } = { count: 0 }] = await ctx.db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM github_sign_ins",
  );
  if (count >= MAX_OUTSTANDING_ATTEMPTS) {
    throw new TeamError("rate-limited", "Too many sign-ins are in progress. Try again shortly.");
  }
  const state = NodeCrypto.randomBytes(32).toString("hex");
  const codeVerifier = NodeCrypto.randomBytes(32).toString("base64url");
  await ctx.db.query(
    "INSERT INTO github_sign_ins (state, code_verifier, device_label, expires_at) VALUES ($1, $2, $3, $4)",
    [state, codeVerifier, input.deviceLabel ?? null, after(ctx, ATTEMPT_TTL)],
  );
  const authorize = new URLSearchParams({
    client_id: ctx.github.clientId,
    redirect_uri: callbackUrl(ctx),
    scope: GITHUB_SCOPE,
    state,
    code_challenge: NodeCrypto.createHash("sha256").update(codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return { state, authorizeUrl: `https://github.com/login/oauth/authorize?${authorize}` };
}

const FAILED_UNKNOWN = "This sign-in expired or was already used. Start again from T3 Code.";

/** Hands the session out exactly once: a completed or failed attempt is deleted as it is read. */
export async function pollGithubSignIn(
  ctx: TeamContext,
  state: string,
): Promise<TeamGithubPollResult> {
  const now = nowIso(ctx);
  await ctx.db.query("DELETE FROM github_sign_ins WHERE expires_at < $1", [now]);
  const [done] = await ctx.db.query<{
    error_message: string | null;
    result_token: string | null;
    result_expires_at: Date | string | null;
    result_user_id: string | null;
  }>(
    `DELETE FROM github_sign_ins
      WHERE state = $1 AND (result_token IS NOT NULL OR error_message IS NOT NULL)
      RETURNING error_message, result_token, result_expires_at, result_user_id`,
    [state],
  );
  if (done) {
    if (done.error_message !== null) return { status: "failed", message: done.error_message };
    const [user] = await ctx.db.query<UserRow>("SELECT * FROM users WHERE id = $1", [
      done.result_user_id,
    ]);
    if (user && done.result_token && done.result_expires_at) {
      return {
        status: "complete",
        auth: {
          token: done.result_token,
          expiresAt: new Date(done.result_expires_at).toISOString(),
          user: toTeamUser(user),
        },
      };
    }
    return { status: "failed", message: FAILED_UNKNOWN };
  }
  const pending = await ctx.db.query("SELECT 1 FROM github_sign_ins WHERE state = $1", [state]);
  return pending.length > 0 ? { status: "pending" } : { status: "failed", message: FAILED_UNKNOWN };
}

export interface CallbackOutcome {
  readonly ok: boolean;
  readonly message: string;
}

const fail = (message: string): CallbackOutcome => ({ ok: false, message });

const setFailed = (ctx: TeamContext, state: string, message: string) =>
  ctx.db.query("UPDATE github_sign_ins SET error_message = $2 WHERE state = $1", [state, message]);

export async function completeGithubSignIn(
  ctx: TeamContext,
  query: URLSearchParams,
): Promise<CallbackOutcome> {
  if (!ctx.github) return fail("GitHub sign-in is not configured on this server.");
  const { clientId, clientSecret, client } = ctx.github;
  const state = query.get("state") ?? "";
  const [attempt] = await ctx.db.query<{ code_verifier: string; device_label: string | null }>(
    `UPDATE github_sign_ins SET callback_at = $2
      WHERE state = $1 AND callback_at IS NULL AND expires_at > $2
      RETURNING code_verifier, device_label`,
    [state, nowIso(ctx)],
  );
  if (!attempt) return fail(FAILED_UNKNOWN);

  const code = query.get("code");
  if (query.get("error") === "access_denied") {
    const message = "GitHub access was denied, so you were not signed in.";
    await setFailed(ctx, state, message);
    return fail(message);
  }
  if (!code) {
    await setFailed(ctx, state, "GitHub did not return a sign-in code. Try again.");
    return fail("GitHub did not return a sign-in code. Try again.");
  }

  let profile: GithubProfile;
  let emails: ReadonlyArray<GithubEmail>;
  try {
    const accessToken = await client.exchangeCode({
      clientId,
      clientSecret,
      code,
      codeVerifier: attempt.code_verifier,
      redirectUri: callbackUrl(ctx),
    });
    [profile, emails] = await Promise.all([
      client.fetchProfile(accessToken),
      client.fetchEmails(accessToken),
    ]);
  } catch (cause) {
    console.error(
      "[team] GitHub sign-in failed:",
      cause instanceof Error ? cause.name : "unknown error",
    );
    const message = "Could not complete the sign-in with GitHub. Try again.";
    await setFailed(ctx, state, message);
    return fail(message);
  }

  if (!hasAllowedEmail(ctx, emails)) {
    // A returning user who no longer qualifies loses their sessions too.
    await ctx.db.query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE github_id = $1)",
      [profile.id],
    );
    const message = `Add and verify an email at one of: ${ctx.allowedEmailDomains.join(", ")} on your GitHub account, then try again.`;
    await setFailed(ctx, state, message);
    return fail(message);
  }

  const user = await ctx.db.transaction((tx) => upsertUser(ctx, tx, profile, emails));
  const session = await createSession(ctx, user.id, attempt.device_label ?? undefined);
  await ctx.db.query(
    "UPDATE github_sign_ins SET result_token = $2, result_expires_at = $3, result_user_id = $4 WHERE state = $1",
    [state, session.token, session.expiresAt, user.id],
  );
  return { ok: true, message: "You're signed in. You can close this tab and return to T3 Code." };
}

function hasAllowedEmail(ctx: TeamContext, emails: ReadonlyArray<GithubEmail>): boolean {
  if (ctx.allowedEmailDomains.length === 0) return true;
  return emails.some(
    (entry) =>
      entry.verified && ctx.allowedEmailDomains.includes(emailDomain(normalizeEmail(entry.email))),
  );
}

/** Mirrors the GitHub account: profile, verified emails, and auto-join memberships. */
async function upsertUser(
  ctx: TeamContext,
  tx: Queryable,
  profile: GithubProfile,
  githubEmails: ReadonlyArray<GithubEmail>,
): Promise<UserRow> {
  const verified = new Map<string, boolean>();
  for (const entry of githubEmails) {
    if (!entry.verified) continue;
    const email = normalizeEmail(entry.email);
    verified.set(email, (verified.get(email) ?? false) || entry.primary);
  }
  const primary = [...verified].find(([, isPrimary]) => isPrimary)?.[0] ?? null;
  const name = profile.name?.trim() || profile.login;

  const [user] = await tx.query<UserRow>(
    `INSERT INTO users (id, github_id, github_login, name, avatar_url, email, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (github_id) DO UPDATE
       SET github_login = excluded.github_login, name = excluded.name,
           avatar_url = excluded.avatar_url, email = excluded.email
     RETURNING *`,
    [crypto.randomUUID(), profile.id, profile.login, name, profile.avatarUrl, primary, nowIso(ctx)],
  );
  if (!user) throw new TeamError("unavailable", "Could not save the account.");

  await tx.query("DELETE FROM user_emails WHERE user_id = $1", [user.id]);
  for (const [email, isPrimary] of verified) {
    await tx.query("INSERT INTO user_emails (user_id, email, is_primary) VALUES ($1, $2, $3)", [
      user.id,
      email,
      isPrimary,
    ]);
  }

  const domains = [...new Set([...verified.keys()].map(emailDomain))].filter(
    (domain) => !isPublicEmailDomain(domain),
  );
  if (domains.length > 0) {
    await tx.query(
      `INSERT INTO memberships (org_id, user_id, role, joined_at)
       SELECT id, $1::text, 'member', $2::timestamptz FROM organizations WHERE auto_join_domain = ANY($3::text[])
       ON CONFLICT DO NOTHING`,
      [user.id, nowIso(ctx), domains],
    );
  }
  return user;
}

export async function signOut(ctx: TeamContext, auth: Authenticated): Promise<void> {
  await ctx.db.query("DELETE FROM sessions WHERE id = $1", [auth.sessionId]);
}
