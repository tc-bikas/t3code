import type { TeamMe, TeamSession, TeamUpdateProfileInput, TeamUser } from "@t3tools/contracts";
import { iso, toTeamUser, type TeamContext, type UserRow } from "./context.ts";
import { TeamError } from "./errors.ts";
import { invitationsFor, membershipsOf } from "./orgs.ts";
import type { Authenticated } from "./sessions.ts";

export async function getMe(ctx: TeamContext, user: UserRow): Promise<TeamMe> {
  const [memberships, invitations, emails] = await Promise.all([
    membershipsOf(user.id, ctx),
    invitationsFor(user, ctx),
    ctx.db.query<{ email: string }>(
      "SELECT email FROM user_emails WHERE user_id = $1 ORDER BY is_primary DESC, email",
      [user.id],
    ),
  ]);
  return {
    user: toTeamUser(user),
    verifiedEmails: emails.map((row) => row.email),
    memberships,
    invitations,
  };
}

export async function updateProfile(
  ctx: TeamContext,
  user: UserRow,
  input: TeamUpdateProfileInput,
): Promise<TeamUser> {
  const name = input.name.trim();
  if (!name) throw new TeamError("invalid-input", "Name is required.");
  await ctx.db.query("UPDATE users SET name = $2 WHERE id = $1", [user.id, name]);
  return toTeamUser({ ...user, name });
}

/** A sole owner cannot walk away from an organisation that still has people in it. */
export async function deleteAccount(ctx: TeamContext, user: UserRow): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const orphaned = await tx.query<{ org_id: string; members: number }>(
      `SELECT m.org_id, (SELECT count(*)::int FROM memberships WHERE org_id = m.org_id) AS members
         FROM memberships m
        WHERE m.user_id = $1 AND m.role = 'owner'
          AND NOT EXISTS (
            SELECT 1 FROM memberships o WHERE o.org_id = m.org_id AND o.role = 'owner' AND o.user_id <> $1
          )`,
      [user.id],
    );
    if (orphaned.some((org) => org.members > 1)) {
      throw new TeamError(
        "last-owner",
        "You are the only owner of an organisation with other members. Make someone else an owner or remove them first.",
      );
    }
    for (const org of orphaned) {
      await tx.query("DELETE FROM organizations WHERE id = $1", [org.org_id]);
    }
    await tx.query(
      "DELETE FROM invites WHERE email IN (SELECT email FROM user_emails WHERE user_id = $1)",
      [user.id],
    );
    await tx.query("DELETE FROM users WHERE id = $1", [user.id]);
  });
}

export async function listSessions(ctx: TeamContext, auth: Authenticated): Promise<TeamSession[]> {
  const rows = await ctx.db.query<{
    id: string;
    label: string;
    created_at: Date | string;
    last_used_at: Date | string;
  }>(
    "SELECT id, label, created_at, last_used_at FROM sessions WHERE user_id = $1 ORDER BY last_used_at DESC",
    [auth.user.id],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: iso(row.created_at),
    lastUsedAt: iso(row.last_used_at),
    current: row.id === auth.sessionId,
  }));
}

export async function revokeSession(
  ctx: TeamContext,
  auth: Authenticated,
  sessionId: string,
): Promise<void> {
  const deleted = await ctx.db.query(
    "DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id",
    [sessionId, auth.user.id],
  );
  if (deleted.length === 0) throw new TeamError("not-found", "Not found.");
}
