import * as Schema from "effect/Schema";

/**
 * The Team service: optional accounts and organisations, hosted apart from any T3 server.
 * Every route lives under `/v1`, speaks JSON, and authenticates with `Authorization: Bearer <token>`.
 * Failures are `{ error: { code, message } }`.
 */

const TEAM_PASSWORD_MIN_LENGTH = 10;
const TEAM_PASSWORD_MAX_LENGTH = 200;
const TEAM_NAME_MAX_LENGTH = 80;

const Email = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
);
const Password = Schema.String.check(
  Schema.isMinLength(TEAM_PASSWORD_MIN_LENGTH),
  Schema.isMaxLength(TEAM_PASSWORD_MAX_LENGTH),
);
const DisplayName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TEAM_NAME_MAX_LENGTH),
);

export const TeamRole = Schema.Literals(["owner", "admin", "member"]);
export type TeamRole = typeof TeamRole.Type;

export const TeamUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  emailVerified: Schema.Boolean,
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
  email: Schema.String,
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

/**
 * Present only when the server has no email provider and prints mail to its console instead.
 * It lets a local developer finish a flow without reading the terminal.
 */
export const TeamDevMail = Schema.Struct({ devLink: Schema.optional(Schema.String) });

export const TeamAuthResult = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
  user: TeamUser,
  devLink: Schema.optional(Schema.String),
});
export type TeamAuthResult = typeof TeamAuthResult.Type;

export const TeamSignUpInput = Schema.Struct({
  email: Email,
  password: Password,
  name: DisplayName,
  deviceLabel: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
});
export type TeamSignUpInput = typeof TeamSignUpInput.Type;

export const TeamSignInInput = Schema.Struct({
  email: Email,
  password: Schema.String.check(Schema.isMaxLength(TEAM_PASSWORD_MAX_LENGTH)),
  deviceLabel: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
});
export type TeamSignInInput = typeof TeamSignInInput.Type;

export const TeamEmailInput = Schema.Struct({ email: Email });
export type TeamEmailInput = typeof TeamEmailInput.Type;

/** `POST /v1/auth/resend-verification` and `POST /v1/auth/forgot-password`. */
export const TeamMailSentResult = TeamDevMail;
export type TeamMailSentResult = typeof TeamMailSentResult.Type;

export const TeamMe = Schema.Struct({
  user: TeamUser,
  memberships: Schema.Array(TeamMembership),
  invitations: Schema.Array(TeamInvitation),
});
export type TeamMe = typeof TeamMe.Type;

export const TeamUpdateProfileInput = Schema.Struct({ name: DisplayName });
export type TeamUpdateProfileInput = typeof TeamUpdateProfileInput.Type;

export const TeamChangePasswordInput = Schema.Struct({
  currentPassword: Schema.String.check(Schema.isMaxLength(TEAM_PASSWORD_MAX_LENGTH)),
  newPassword: Password,
});
export type TeamChangePasswordInput = typeof TeamChangePasswordInput.Type;

export const TeamDeleteAccountInput = Schema.Struct({
  password: Schema.String.check(Schema.isMaxLength(TEAM_PASSWORD_MAX_LENGTH)),
});
export type TeamDeleteAccountInput = typeof TeamDeleteAccountInput.Type;

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
  "email-taken",
  "invalid-credentials",
  "email-not-verified",
  "weak-password",
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
