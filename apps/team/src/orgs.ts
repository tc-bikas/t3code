import type {
  TeamCreateOrganizationInput,
  TeamInvitation,
  TeamInviteInput,
  TeamInviteResult,
  TeamMembership,
  TeamOrganization,
  TeamOrganizationDetail,
  TeamPendingInvite,
  TeamRole,
  TeamSetMemberRoleInput,
  TeamUpdateOrganizationInput,
} from "@t3tools/contracts";
import { after, iso, nowIso, type TeamContext, type UserRow } from "./context.ts";
import { isUniqueViolation, type Queryable } from "./db.ts";
import { isPublicEmailDomain, isValidDomain, normalizeEmail } from "./domains.ts";
import { TeamError } from "./errors.ts";
import { DAY } from "./tokens.ts";

const INVITE_TTL = 14 * DAY;

type Time = Date | string;

interface OrgRow {
  id: string;
  name: string;
  auto_join_domain: string | null;
  member_count: number;
  created_at: Time;
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: TeamRole;
  invited_by_name: string;
  created_at: Time;
  expires_at: Time;
}

const ORG_SELECT = `SELECT o.*, (SELECT count(*)::int FROM memberships WHERE org_id = o.id) AS member_count
  FROM organizations o`;

const toOrganization = (row: OrgRow): TeamOrganization => ({
  id: row.id,
  name: row.name,
  autoJoinDomain: row.auto_join_domain,
  memberCount: row.member_count,
  createdAt: iso(row.created_at),
});

const toPendingInvite = (row: InviteRow): TeamPendingInvite => ({
  id: row.id,
  email: row.email,
  role: row.role,
  invitedByName: row.invited_by_name,
  createdAt: iso(row.created_at),
  expiresAt: iso(row.expires_at),
});

const notFound = () => new TeamError("not-found", "Not found.");

const cleanName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) throw new TeamError("invalid-input", "Name is required.");
  return trimmed;
};

/** Non-members learn nothing: an organisation they are not in does not exist for them. */
async function roleIn(tx: Queryable, orgId: string, userId: string): Promise<TeamRole> {
  const rows = await tx.query<{ role: TeamRole }>(
    "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
    [orgId, userId],
  );
  const role = rows[0]?.role;
  if (!role) throw notFound();
  return role;
}

const assertRole = (role: TeamRole, allowed: ReadonlyArray<TeamRole>) => {
  if (!allowed.includes(role)) {
    throw new TeamError("forbidden", "You do not have permission to do that.");
  }
};

/** Locks the owner rows so two concurrent demotions cannot both pass the last-owner check. */
async function lockOwners(tx: Queryable, orgId: string): Promise<string[]> {
  const rows = await tx.query<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE org_id = $1 AND role = 'owner' FOR UPDATE",
    [orgId],
  );
  return rows.map((row) => row.user_id);
}

const lastOwner = () =>
  new TeamError(
    "last-owner",
    "An organisation needs at least one owner. Make someone else an owner first.",
  );

async function detail(
  ctx: TeamContext,
  tx: Queryable,
  orgId: string,
  role: TeamRole,
): Promise<TeamOrganizationDetail> {
  const [org] = await tx.query<OrgRow>(`${ORG_SELECT} WHERE o.id = $1`, [orgId]);
  if (!org) throw notFound();
  const members = await tx.query<{
    user_id: string;
    name: string;
    github_login: string;
    avatar_url: string | null;
    email: string | null;
    role: TeamRole;
    joined_at: Time;
  }>(
    `SELECT m.user_id, u.name, u.github_login, u.avatar_url, u.email, m.role, m.joined_at
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 ORDER BY m.joined_at, u.github_login`,
    [orgId],
  );
  const invites =
    role === "member"
      ? []
      : await tx.query<InviteRow>(
          "SELECT * FROM invites WHERE org_id = $1 AND expires_at > $2 ORDER BY created_at",
          [orgId, nowIso(ctx)],
        );
  return {
    organization: toOrganization(org),
    role,
    members: members.map((row) => ({
      userId: row.user_id,
      name: row.name,
      githubLogin: row.github_login,
      avatarUrl: row.avatar_url,
      email: row.email,
      role: row.role,
      joinedAt: iso(row.joined_at),
    })),
    invites: invites.map(toPendingInvite),
  };
}

export async function membershipsOf(userId: string, ctx: TeamContext): Promise<TeamMembership[]> {
  const rows = await ctx.db.query<OrgRow & { role: TeamRole }>(
    `SELECT o.*, m.role, (SELECT count(*)::int FROM memberships WHERE org_id = o.id) AS member_count
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1 ORDER BY m.joined_at`,
    [userId],
  );
  return rows.map((row) => ({ organization: toOrganization(row), role: row.role }));
}

const OWN_EMAILS = "SELECT email FROM user_emails WHERE user_id =";

/** Invitations reach any email GitHub has verified for the account. */
export async function invitationsFor(user: UserRow, ctx: TeamContext): Promise<TeamInvitation[]> {
  const rows = await ctx.db.query<InviteRow & { organization_name: string }>(
    `SELECT i.*, o.name AS organization_name
       FROM invites i JOIN organizations o ON o.id = i.org_id
      WHERE i.email IN (${OWN_EMAILS} $1) AND i.expires_at > $2 ORDER BY i.created_at`,
    [user.id, nowIso(ctx)],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.org_id,
    organizationName: row.organization_name,
    invitedByName: row.invited_by_name,
    role: row.role,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  }));
}

export async function createOrganization(
  ctx: TeamContext,
  user: UserRow,
  input: TeamCreateOrganizationInput,
): Promise<TeamOrganizationDetail> {
  const name = cleanName(input.name);
  return ctx.db.transaction(async (tx) => {
    const id = crypto.randomUUID();
    await tx.query("INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, $3)", [
      id,
      name,
      nowIso(ctx),
    ]);
    await tx.query(
      "INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', $3)",
      [id, user.id, nowIso(ctx)],
    );
    return detail(ctx, tx, id, "owner");
  });
}

export async function getOrganization(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
): Promise<TeamOrganizationDetail> {
  return ctx.db.transaction(async (tx) => detail(ctx, tx, orgId, await roleIn(tx, orgId, user.id)));
}

async function claimDomain(
  ctx: TeamContext,
  tx: Queryable,
  user: UserRow,
  orgId: string,
  rawDomain: string,
): Promise<void> {
  const domain = rawDomain.trim().toLowerCase();
  const refused = (message: string) => new TeamError("domain-not-allowed", message);
  if (!isValidDomain(domain)) throw refused("That is not a valid domain.");
  if (isPublicEmailDomain(domain)) {
    throw refused("Public email providers cannot be used for auto-join.");
  }
  const own = await tx.query(
    "SELECT 1 FROM user_emails WHERE user_id = $1 AND split_part(email, '@', 2) = $2",
    [user.id, domain],
  );
  if (own.length === 0) {
    throw refused("You can only use the domain of one of your own verified GitHub emails.");
  }
  const claimed = await tx.query(
    "SELECT 1 FROM organizations WHERE auto_join_domain = $1 AND id <> $2",
    [domain, orgId],
  );
  if (claimed.length > 0) throw refused("Another organisation already uses this domain.");
  try {
    await tx.query("UPDATE organizations SET auto_join_domain = $2 WHERE id = $1", [orgId, domain]);
  } catch (cause) {
    throw isUniqueViolation(cause)
      ? refused("Another organisation already uses this domain.")
      : cause;
  }
  await tx.query(
    `INSERT INTO memberships (org_id, user_id, role, joined_at)
     SELECT DISTINCT $1::text, user_id, 'member', $2::timestamptz FROM user_emails WHERE split_part(email, '@', 2) = $3
     ON CONFLICT DO NOTHING`,
    [orgId, nowIso(ctx), domain],
  );
}

export async function updateOrganization(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
  input: TeamUpdateOrganizationInput,
): Promise<TeamOrganizationDetail> {
  return ctx.db.transaction(async (tx) => {
    const role = await roleIn(tx, orgId, user.id);
    assertRole(role, input.autoJoinDomain === undefined ? ["owner", "admin"] : ["owner"]);
    if (input.name !== undefined) {
      await tx.query("UPDATE organizations SET name = $2 WHERE id = $1", [
        orgId,
        cleanName(input.name),
      ]);
    }
    if (input.autoJoinDomain === null) {
      await tx.query("UPDATE organizations SET auto_join_domain = NULL WHERE id = $1", [orgId]);
    } else if (input.autoJoinDomain !== undefined) {
      await claimDomain(ctx, tx, user, orgId, input.autoJoinDomain);
    }
    return detail(ctx, tx, orgId, role);
  });
}

export async function deleteOrganization(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    assertRole(await roleIn(tx, orgId, user.id), ["owner"]);
    await tx.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });
}

export async function inviteMember(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
  input: TeamInviteInput,
): Promise<TeamInviteResult> {
  const email = normalizeEmail(input.email);
  const invite = await ctx.db.transaction(async (tx) => {
    assertRole(await roleIn(tx, orgId, user.id), ["owner", "admin"]);
    const member = await tx.query(
      `SELECT 1 FROM memberships m JOIN user_emails e ON e.user_id = m.user_id
        WHERE m.org_id = $1 AND e.email = $2`,
      [orgId, email],
    );
    if (member.length > 0) {
      throw new TeamError("already-member", "That person is already in this organisation.");
    }
    const [row] = await tx.query<InviteRow>(
      `INSERT INTO invites (id, org_id, email, role, invited_by_name, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (org_id, email) DO UPDATE SET id = excluded.id, role = excluded.role,
         invited_by_name = excluded.invited_by_name, created_at = excluded.created_at,
         expires_at = excluded.expires_at
       RETURNING *`,
      [
        crypto.randomUUID(),
        orgId,
        email,
        input.role,
        user.name,
        nowIso(ctx),
        after(ctx, INVITE_TTL),
      ],
    );
    if (!row) throw notFound();
    return row;
  });
  return { invite: toPendingInvite(invite) };
}

export async function revokeInvite(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
  inviteId: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    assertRole(await roleIn(tx, orgId, user.id), ["owner", "admin"]);
    const deleted = await tx.query(
      "DELETE FROM invites WHERE id = $1 AND org_id = $2 RETURNING id",
      [inviteId, orgId],
    );
    if (deleted.length === 0) throw notFound();
  });
}

export async function setMemberRole(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
  userId: string,
  input: TeamSetMemberRoleInput,
): Promise<TeamOrganizationDetail> {
  return ctx.db.transaction(async (tx) => {
    const actorRole = await roleIn(tx, orgId, user.id);
    assertRole(actorRole, ["owner"]);
    const owners = await lockOwners(tx, orgId);
    const targetRole = await roleIn(tx, orgId, userId);
    if (targetRole === "owner" && input.role !== "owner" && owners.length <= 1) throw lastOwner();
    await tx.query("UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2", [
      orgId,
      userId,
      input.role,
    ]);
    return detail(ctx, tx, orgId, actorRole);
  });
}

export async function removeMember(
  ctx: TeamContext,
  user: UserRow,
  orgId: string,
  userId: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const actorRole = await roleIn(tx, orgId, user.id);
    const owners = await lockOwners(tx, orgId);
    if (userId === user.id) {
      if (actorRole === "owner" && owners.length <= 1) throw lastOwner();
    } else {
      assertRole(actorRole, ["owner", "admin"]);
      const targetRole = await roleIn(tx, orgId, userId);
      if (actorRole === "admin") assertRole(targetRole, ["member"]);
    }
    await tx.query("DELETE FROM memberships WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  });
}

export async function acceptInvitation(
  ctx: TeamContext,
  user: UserRow,
  inviteId: string,
): Promise<TeamOrganizationDetail> {
  return ctx.db.transaction(async (tx) => {
    const [invite] = await tx.query<InviteRow>("SELECT * FROM invites WHERE id = $1", [inviteId]);
    if (!invite) throw notFound();
    const own = await tx.query(`${OWN_EMAILS} $1 AND email = $2`, [user.id, invite.email]);
    if (own.length === 0) {
      throw new TeamError("forbidden", "This invitation was sent to a different email address.");
    }
    if (new Date(invite.expires_at).getTime() <= ctx.now()) {
      throw new TeamError("invite-expired", "This invitation has expired. Ask for a new one.");
    }
    const inserted = await tx.query(
      `INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [invite.org_id, user.id, invite.role, nowIso(ctx)],
    );
    if (inserted.length === 0) {
      throw new TeamError("already-member", "You are already in this organisation.");
    }
    await tx.query("DELETE FROM invites WHERE id = $1", [inviteId]);
    return detail(ctx, tx, invite.org_id, invite.role);
  });
}

export async function declineInvitation(
  ctx: TeamContext,
  user: UserRow,
  inviteId: string,
): Promise<void> {
  const deleted = await ctx.db.query(
    `DELETE FROM invites WHERE id = $1 AND email IN (${OWN_EMAILS} $2) RETURNING id`,
    [inviteId, user.id],
  );
  if (deleted.length === 0) throw notFound();
}
