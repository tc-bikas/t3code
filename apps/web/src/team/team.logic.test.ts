import { TeamErrorCode } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  autoJoinDomains,
  canChangeMemberRole,
  canRemoveMember,
  normalizeTeamServerUrl,
  organizationPermissions,
  resolveActiveOrganizationId,
  teamDeviceLabel,
  teamErrorMessage,
  teamInitials,
} from "./team.logic";

describe("normalizeTeamServerUrl", () => {
  it("accepts http(s) origins and trims trailing slashes", () => {
    expect(normalizeTeamServerUrl(" http://localhost:3790/ ")).toBe("http://localhost:3790");
    expect(normalizeTeamServerUrl("https://team.example.com/api/")).toBe(
      "https://team.example.com/api",
    );
  });

  it("rejects other schemes, credentials, and junk", () => {
    for (const input of ["", "localhost:3790", "ftp://x.test", "https://a:b@x.test", "x?y=1"]) {
      expect(normalizeTeamServerUrl(input)).toBeNull();
    }
  });
});

describe("autoJoinDomains", () => {
  it("keeps distinct work domains and drops public providers, case-insensitively", () => {
    expect(
      autoJoinDomains(["ada@Gmail.com", "ada@Acme.dev", "ada.l@acme.dev", "ada@proton.me", "bad@"]),
    ).toEqual(["acme.dev"]);
    expect(autoJoinDomains([])).toEqual([]);
  });
});

describe("permissions", () => {
  const owner = { userId: "o", role: "owner" } as const;
  const admin = { userId: "a", role: "admin" } as const;
  const member = { userId: "m", role: "member" } as const;

  it("limits organisation actions by role", () => {
    expect(organizationPermissions("owner")).toEqual({
      canRename: true,
      canInvite: true,
      canManageAutoJoin: true,
      canDelete: true,
    });
    expect(organizationPermissions("admin")).toEqual({
      canRename: false,
      canInvite: true,
      canManageAutoJoin: false,
      canDelete: false,
    });
    expect(organizationPermissions("member").canInvite).toBe(false);
  });

  it("lets only owners change other people's roles", () => {
    expect(canChangeMemberRole("owner", "o", admin)).toBe(true);
    expect(canChangeMemberRole("owner", "o", owner)).toBe(false);
    expect(canChangeMemberRole("admin", "a", member)).toBe(false);
  });

  it("lets admins remove members only, owners anyone but themselves", () => {
    expect(canRemoveMember("admin", "a", member)).toBe(true);
    expect(canRemoveMember("admin", "a", owner)).toBe(false);
    expect(canRemoveMember("admin", "a", admin)).toBe(false);
    expect(canRemoveMember("owner", "o", admin)).toBe(true);
    expect(canRemoveMember("owner", "o", owner)).toBe(false);
    expect(canRemoveMember("member", "m", member)).toBe(false);
  });
});

describe("teamErrorMessage", () => {
  it("has a readable message for every server error code and the client ones", () => {
    const codes = [...TeamErrorCode.literals, "unreachable", "bad-response"] as const;
    for (const code of codes) {
      expect(teamErrorMessage(code, "http://x.test").length).toBeGreaterThan(10);
    }
    expect(teamErrorMessage("unreachable", "http://x.test")).toContain("http://x.test");
    expect(teamErrorMessage("last-owner", "")).toContain("owner");
  });
});

describe("small helpers", () => {
  it("falls back to the first organisation when the stored one is gone", () => {
    expect(resolveActiveOrganizationId(["a", "b"], "b")).toBe("b");
    expect(resolveActiveOrganizationId(["a", "b"], "zzz")).toBe("a");
    expect(resolveActiveOrganizationId([], "a")).toBeNull();
  });

  it("builds initials and device labels", () => {
    expect(teamInitials("Ada King Lovelace")).toBe("AL");
    expect(teamInitials("ada")).toBe("A");
    expect(teamInitials("  ")).toBe("?");
    expect(teamDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X)", true)).toBe(
      "T3 Code on macOS",
    );
    expect(teamDeviceLabel("Mozilla/5.0 (Macintosh)", false)).toBe("T3 Code (web)");
  });
});
