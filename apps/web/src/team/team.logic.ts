import { TeamEmailInput, type TeamErrorCode, type TeamRole } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const DEFAULT_TEAM_SERVER_URL = "http://localhost:3790";

/** Mirrors the Team service's password rule in `packages/contracts/src/team.ts`. */
export const TEAM_PASSWORD_MIN_LENGTH = 10;

export type TeamClientErrorCode = TeamErrorCode | "unreachable" | "bad-response";

const isEmailInput = Schema.is(TeamEmailInput);
const isValidEmail = (email: string) => isEmailInput({ email });

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function normalizeTeamServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const url = parseUrl(trimmed);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  if (url.search !== "" || url.hash !== "" || url.username !== "") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function teamEmailIssue(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed === "") return "Enter an email address.";
  return isValidEmail(trimmed) ? null : "That doesn't look like an email address.";
}

export function teamNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter your name.";
  return trimmed.length > 80 ? "Use 80 characters or fewer." : null;
}

export function teamPasswordIssue(password: string): string | null {
  return password.length < TEAM_PASSWORD_MIN_LENGTH
    ? `Use at least ${TEAM_PASSWORD_MIN_LENGTH} characters.`
    : null;
}

// Mirrors the backend's list of mailbox providers that cannot claim a domain.
const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "yandex.com",
  "qq.com",
  "163.com",
]);

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at < 0 || at === email.length - 1 ? null : email.slice(at + 1).toLowerCase();
}

function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

export type AutoJoinEligibility =
  | { readonly eligible: true; readonly domain: string }
  | { readonly eligible: false; readonly reason: string };

export function autoJoinEligibility(user: {
  readonly email: string;
  readonly emailVerified: boolean;
}): AutoJoinEligibility {
  const domain = emailDomain(user.email);
  if (domain === null) return { eligible: false, reason: "Your email address has no domain." };
  if (!user.emailVerified) {
    return { eligible: false, reason: "Verify your email to turn on auto-join." };
  }
  if (isPublicEmailDomain(domain)) {
    return {
      eligible: false,
      reason: `${domain} is a public email provider, so it can't be claimed. Sign in with a work email to use auto-join.`,
    };
  }
  return { eligible: true, domain };
}

export interface TeamOrganizationPermissions {
  readonly canRename: boolean;
  readonly canInvite: boolean;
  readonly canManageAutoJoin: boolean;
  readonly canDelete: boolean;
}

export function organizationPermissions(role: TeamRole): TeamOrganizationPermissions {
  return {
    canRename: role === "owner",
    canInvite: role === "owner" || role === "admin",
    canManageAutoJoin: role === "owner",
    canDelete: role === "owner",
  };
}

interface MemberTarget {
  readonly userId: string;
  readonly role: TeamRole;
}

export function canChangeMemberRole(
  actorRole: TeamRole,
  actorUserId: string,
  target: MemberTarget,
): boolean {
  return actorRole === "owner" && target.userId !== actorUserId;
}

export function canRemoveMember(
  actorRole: TeamRole,
  actorUserId: string,
  target: MemberTarget,
): boolean {
  if (target.userId === actorUserId) return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && target.role === "member";
}

export function resolveActiveOrganizationId(
  organizationIds: ReadonlyArray<string>,
  storedId: string,
): string | null {
  return organizationIds.includes(storedId) ? storedId : (organizationIds[0] ?? null);
}

export function organizationDeleteConfirmed(typed: string, organizationName: string): boolean {
  return typed.trim() === organizationName;
}

export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = [words[0], words.length > 1 ? words.at(-1) : undefined]
    .map((word) => (word === undefined ? "" : (Array.from(word)[0] ?? "")))
    .join("");
  return letters.toUpperCase() || "?";
}

export function teamDeviceLabel(userAgent: string, isDesktopApp: boolean): string {
  if (!isDesktopApp) return "T3 Code (web)";
  const system = /Mac/i.test(userAgent)
    ? "macOS"
    : /Windows/i.test(userAgent)
      ? "Windows"
      : /Linux/i.test(userAgent)
        ? "Linux"
        : null;
  return system === null ? "T3 Code (desktop)" : `T3 Code on ${system}`;
}

export function teamErrorMessage(code: TeamClientErrorCode, serverUrl: string): string {
  switch (code) {
    case "unreachable":
      return `Can't reach the Team server at ${serverUrl}.`;
    case "bad-response":
      return `The server at ${serverUrl} didn't answer like a Team server. Check the address.`;
    case "invalid-input":
      return "Some of what you entered isn't valid. Check it and try again.";
    case "unauthorized":
      return "You've been signed out. Sign in again to continue.";
    case "forbidden":
      return "Your role in this organisation doesn't allow that.";
    case "not-found":
      return "That no longer exists. It may have been removed.";
    case "email-taken":
      return "An account with that email already exists. Try signing in instead.";
    case "invalid-credentials":
      return "That email and password don't match.";
    case "email-not-verified":
      return "Verify your email first. Use the link we sent you.";
    case "weak-password":
      return `Choose a stronger password of at least ${TEAM_PASSWORD_MIN_LENGTH} characters.`;
    case "rate-limited":
      return "Too many attempts. Wait a moment and try again.";
    case "domain-not-allowed":
      return "That email domain can't be used for auto-join. Use your own work domain.";
    case "last-owner":
      return "Every organisation needs an owner. Make someone else an owner first.";
    case "already-member":
      return "That person is already a member of this organisation.";
    case "invite-expired":
      return "That invitation has expired. Ask for a new one.";
    case "unavailable":
      return "The Team server is having trouble. Try again in a moment.";
  }
}
