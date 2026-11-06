import type {
  TeamAuthResult,
  TeamEmailInput,
  TeamMailSentResult,
  TeamSignInInput,
  TeamSignUpInput,
} from "@t3tools/contracts";
import {
  devLink,
  nowIso,
  sendMail,
  toTeamUser,
  type TeamContext,
  type UserRow,
} from "./context.ts";
import { isUniqueViolation, type Queryable } from "./db.ts";
import { emailDomain, normalizeEmail } from "./domains.ts";
import { resetMail, verifyMail } from "./email.ts";
import { TeamError } from "./errors.ts";
import {
  assertStrongPassword,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "./passwords.ts";
import { assertNotLocked, consume, LOGIN_LIMIT, MAIL_LIMIT, SIGNUP_LIMIT } from "./rateLimit.ts";
import { createSession, type Authenticated } from "./sessions.ts";
import { consumeEmailToken, issueEmailToken, peekEmailToken } from "./tokens.ts";

const verifyLink = (ctx: TeamContext, token: string) =>
  `${ctx.publicUrl}/verify-email?token=${token}`;
const resetLink = (ctx: TeamContext, token: string) =>
  `${ctx.publicUrl}/reset-password?token=${token}`;

async function startVerification(ctx: TeamContext, user: UserRow): Promise<{ devLink?: string }> {
  const link = verifyLink(ctx, await issueEmailToken(ctx, user.id, "verify"));
  await sendMail(ctx, verifyMail(user.email, link));
  return devLink(ctx, link);
}

export async function signUp(
  ctx: TeamContext,
  input: TeamSignUpInput,
  ip: string,
): Promise<TeamAuthResult> {
  consume(ctx.limiter, "signup", [`ip:${ip}`], SIGNUP_LIMIT);
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!name) throw new TeamError("invalid-input", "Name is required.");
  assertStrongPassword(input.password, email);
  const taken = new TeamError("email-taken", "An account with this email already exists.");
  const existing = await ctx.db.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (existing.length > 0) throw taken;
  const passwordHash = await hashPassword(input.password);
  const [user] = await ctx.db
    .query<UserRow>(
      "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [crypto.randomUUID(), email, name, passwordHash, nowIso(ctx)],
    )
    .catch((cause: unknown) => {
      throw isUniqueViolation(cause) ? taken : cause;
    });
  if (!user) throw new TeamError("unavailable", "Could not create the account.");
  const session = await createSession(ctx, user.id, input.deviceLabel);
  return { ...session, user: toTeamUser(user), ...(await startVerification(ctx, user)) };
}

export async function signIn(
  ctx: TeamContext,
  input: TeamSignInInput,
  ip: string,
): Promise<TeamAuthResult> {
  const email = normalizeEmail(input.email);
  const keys = [`ip:${ip}`, `email:${email}`];
  assertNotLocked(ctx.limiter, "login", keys, LOGIN_LIMIT);
  const [user] = await ctx.db.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  const valid = user
    ? await verifyPassword(input.password, user.password_hash)
    : await verifyAgainstDummy(input.password);
  if (!user || !valid) {
    for (const key of keys) ctx.limiter.hit(`login:${key}`, LOGIN_LIMIT.windowMs);
    throw new TeamError("invalid-credentials", "Wrong email or password.");
  }
  ctx.limiter.clear(`login:email:${email}`);
  return { ...(await createSession(ctx, user.id, input.deviceLabel)), user: toTeamUser(user) };
}

/** Re-checks the password of a signed-in user, sharing the sign-in failure budget. */
export async function confirmPassword(
  ctx: TeamContext,
  user: UserRow,
  password: string,
): Promise<void> {
  const key = `email:${user.email}`;
  assertNotLocked(ctx.limiter, "login", [key], LOGIN_LIMIT);
  if (!(await verifyPassword(password, user.password_hash))) {
    ctx.limiter.hit(`login:${key}`, LOGIN_LIMIT.windowMs);
    throw new TeamError("invalid-credentials", "Wrong password.");
  }
}

export async function signOut(ctx: TeamContext, auth: Authenticated): Promise<void> {
  await ctx.db.query("DELETE FROM sessions WHERE id = $1", [auth.sessionId]);
}

export async function resendVerification(
  ctx: TeamContext,
  auth: Authenticated,
  ip: string,
): Promise<TeamMailSentResult> {
  consume(ctx.limiter, "mail", [`ip:${ip}`, `email:${auth.user.email}`], MAIL_LIMIT);
  if (auth.user.email_verified) return {};
  return startVerification(ctx, auth.user);
}

export async function forgotPassword(
  ctx: TeamContext,
  input: TeamEmailInput,
  ip: string,
): Promise<TeamMailSentResult> {
  const email = normalizeEmail(input.email);
  consume(ctx.limiter, "mail", [`ip:${ip}`, `email:${email}`], MAIL_LIMIT);
  const [user] = await ctx.db.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  if (!user) return {};
  const link = resetLink(ctx, await issueEmailToken(ctx, user.id, "reset"));
  void sendMail(ctx, resetMail(user.email, link));
  return devLink(ctx, link);
}

/** Joins the user, as a member, to every organisation that claims their email domain. */
async function joinAutoJoinOrganizations(
  ctx: TeamContext,
  tx: Queryable,
  user: Pick<UserRow, "id" | "email">,
): Promise<void> {
  await tx.query(
    `INSERT INTO memberships (org_id, user_id, role, joined_at)
     SELECT id, $1, 'member', $2 FROM organizations WHERE auto_join_domain = $3
     ON CONFLICT DO NOTHING`,
    [user.id, nowIso(ctx), emailDomain(user.email)],
  );
}

export async function verifyEmail(ctx: TeamContext, token: string): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const userId = await consumeEmailToken(ctx, tx, token, "verify");
    if (!userId) return false;
    const [user] = await tx.query<UserRow>(
      "UPDATE users SET email_verified = true WHERE id = $1 RETURNING *",
      [userId],
    );
    if (user) await joinAutoJoinOrganizations(ctx, tx, user);
    return true;
  });
}

export const isResetTokenValid = async (ctx: TeamContext, token: string): Promise<boolean> =>
  (await peekEmailToken(ctx, token, "reset")) !== undefined;

/** Sets a new password from a reset link and signs the account out everywhere. */
export async function resetPassword(
  ctx: TeamContext,
  token: string,
  password: string,
): Promise<void> {
  const invalid = new TeamError("not-found", "This reset link is invalid or has expired.");
  const userId = await peekEmailToken(ctx, token, "reset");
  if (!userId) throw invalid;
  const [user] = await ctx.db.query<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) throw invalid;
  if (password.length < 10 || password.length > 200) {
    throw new TeamError("weak-password", "Use between 10 and 200 characters.");
  }
  assertStrongPassword(password, user.email);
  const passwordHash = await hashPassword(password);
  await ctx.db.transaction(async (tx) => {
    if (!(await consumeEmailToken(ctx, tx, token, "reset"))) throw invalid;
    await tx.query("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, passwordHash]);
    await tx.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  });
  ctx.limiter.clear(`login:email:${user.email}`);
}
