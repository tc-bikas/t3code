import type { TeamErrorCode, TeamRole } from "@t3tools/contracts";

export const DEFAULT_TEAM_SERVER_URL = "http://localhost:3790";

export type TeamClientErrorCode = TeamErrorCode | "unreachable" | "bad-response";

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

export function teamNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter your name.";
  return trimmed.length > 80 ? "Use 80 characters or fewer." : null;
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

/** Work domains among a person's verified emails: the ones an owner may claim for auto-join. */
export function autoJoinDomains(verifiedEmails: ReadonlyArray<string>): ReadonlyArray<string> {
  const domains = verifiedEmails.flatMap((email) => {
    const domain = emailDomain(email);
    return domain === null || PUBLIC_EMAIL_DOMAINS.has(domain) ? [] : [domain];
  });
  return [...new Set(domains)];
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
      return "You don't have permission to do that.";
    case "not-found":
      return "That no longer exists. It may have been removed.";
    case "not-configured":
      return "GitHub sign-in isn't set up on this Team server yet.";
    case "rate-limited":
      return "Too many requests. Wait a moment and try again.";
    case "not-allowed":
      return "You can't message that person.";
    case "domain-not-allowed":
      return "That domain can't be used for auto-join. Use a work email verified on your GitHub account.";
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
