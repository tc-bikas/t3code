import * as Schema from "effect/Schema";

/**
 * The Team service: optional GitHub sign-in and organisations, hosted apart from any T3 server.
 * Every route lives under `/v1`, speaks JSON, and authenticates with `Authorization: Bearer <token>`.
 * Failures are `{ error: { code, message } }`.
 */

const TEAM_NAME_MAX_LENGTH = 80;

const Email = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
);
const DisplayName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TEAM_NAME_MAX_LENGTH),
);

export const TeamRole = Schema.Literals(["owner", "admin", "member"]);
export type TeamRole = typeof TeamRole.Type;

export const TeamUser = Schema.Struct({
  id: Schema.String,
  githubLogin: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  /** The primary verified GitHub email, or null when the account has none. */
  email: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type TeamUser = typeof TeamUser.Type;

export const TeamOrganization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Verified work-email domain whose owners' colleagues join automatically, or null. */
  autoJoinDomain: Schema.NullOr(Schema.String),
  memberCount: Schema.Number,
  createdAt: Schema.String,
});
export type TeamOrganization = typeof TeamOrganization.Type;

export const TeamMembership = Schema.Struct({
  organization: TeamOrganization,
  role: TeamRole,
});
export type TeamMembership = typeof TeamMembership.Type;

export const TeamMember = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  githubLogin: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  role: TeamRole,
  joinedAt: Schema.String,
});
export type TeamMember = typeof TeamMember.Type;

/** An invitation as the invited person sees it. */
export const TeamInvitation = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  organizationName: Schema.String,
  invitedByName: Schema.String,
  role: TeamRole,
  createdAt: Schema.String,
  expiresAt: Schema.String,
});
export type TeamInvitation = typeof TeamInvitation.Type;

/** An invitation as an organisation admin sees it. */
export const TeamPendingInvite = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: TeamRole,
  invitedByName: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
});
export type TeamPendingInvite = typeof TeamPendingInvite.Type;

export const TeamSession = Schema.Struct({
  id: Schema.String,
  /** Where the sign-in came from, as the client labelled it, e.g. "T3 Code on macOS". */
  label: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.String,
  current: Schema.Boolean,
});
export type TeamSession = typeof TeamSession.Type;

export const TeamAuthConfig = Schema.Struct({ githubConfigured: Schema.Boolean });
export type TeamAuthConfig = typeof TeamAuthConfig.Type;

export const TeamAuthResult = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
  user: TeamUser,
});
export type TeamAuthResult = typeof TeamAuthResult.Type;

export const TeamGithubStartInput = Schema.Struct({
  deviceLabel: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
});
export type TeamGithubStartInput = typeof TeamGithubStartInput.Type;

/** Open `authorizeUrl` in a browser, then poll with `state` until the sign-in completes. */
export const TeamGithubStartResult = Schema.Struct({
  state: Schema.String,
  authorizeUrl: Schema.String,
});
export type TeamGithubStartResult = typeof TeamGithubStartResult.Type;

export const TeamGithubPollResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("complete"), auth: TeamAuthResult }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
]);
export type TeamGithubPollResult = typeof TeamGithubPollResult.Type;

export const TeamMe = Schema.Struct({
  user: TeamUser,
  /** Every verified email on the GitHub account; invitations and auto-join match any of them. */
  verifiedEmails: Schema.Array(Schema.String),
  memberships: Schema.Array(TeamMembership),
  invitations: Schema.Array(TeamInvitation),
});
export type TeamMe = typeof TeamMe.Type;

export const TeamUpdateProfileInput = Schema.Struct({ name: DisplayName });
export type TeamUpdateProfileInput = typeof TeamUpdateProfileInput.Type;

export const TeamSessionsResult = Schema.Struct({ sessions: Schema.Array(TeamSession) });
export type TeamSessionsResult = typeof TeamSessionsResult.Type;

export const TeamCreateOrganizationInput = Schema.Struct({ name: DisplayName });
export type TeamCreateOrganizationInput = typeof TeamCreateOrganizationInput.Type;

export const TeamOrganizationDetail = Schema.Struct({
  organization: TeamOrganization,
  role: TeamRole,
  members: Schema.Array(TeamMember),
  /** Owners and admins only; empty for members. */
  invites: Schema.Array(TeamPendingInvite),
});
export type TeamOrganizationDetail = typeof TeamOrganizationDetail.Type;

export const TeamUpdateOrganizationInput = Schema.Struct({
  name: Schema.optional(DisplayName),
  /** A domain, or null to turn auto-join off. Owners only, and only the owner's own verified domain. */
  autoJoinDomain: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(253)))),
});
export type TeamUpdateOrganizationInput = typeof TeamUpdateOrganizationInput.Type;

export const TeamInviteInput = Schema.Struct({
  email: Email,
  role: Schema.Literals(["admin", "member"]),
});
export type TeamInviteInput = typeof TeamInviteInput.Type;

export const TeamInviteResult = Schema.Struct({ invite: TeamPendingInvite });
export type TeamInviteResult = typeof TeamInviteResult.Type;

export const TeamSetMemberRoleInput = Schema.Struct({ role: TeamRole });
export type TeamSetMemberRoleInput = typeof TeamSetMemberRoleInput.Type;

export const TeamErrorCode = Schema.Literals([
  "invalid-input",
  "unauthorized",
  "forbidden",
  "not-found",
  "not-configured",
  "rate-limited",
  "domain-not-allowed",
  "last-owner",
  "already-member",
  "invite-expired",
  "unavailable",
]);
export type TeamErrorCode = typeof TeamErrorCode.Type;

export const TeamErrorBody = Schema.Struct({
  error: Schema.Struct({ code: TeamErrorCode, message: Schema.String }),
});
export type TeamErrorBody = typeof TeamErrorBody.Type;
