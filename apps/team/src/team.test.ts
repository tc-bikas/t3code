import type {
  TeamAuthResult,
  TeamInviteResult,
  TeamMe,
  TeamOrganizationDetail,
  TeamSessionsResult,
} from "@t3tools/contracts";
import type * as NodeNet from "node:net";
import { describe, expect, it } from "vite-plus/test";
import { openPglite } from "./db.ts";
import type { EmailSender, Mail } from "./email.ts";
import { migrate } from "./migrations.ts";
import { createRateLimiter } from "./rateLimit.ts";
import { createTeamServer, handleRequest } from "./server.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery";

async function withTeam(
  fn: (t: Awaited<ReturnType<typeof createHarness>>) => Promise<void>,
  options: { consoleMail?: boolean } = {},
) {
  const t = await createHarness(options.consoleMail ?? true);
  try {
    await fn(t);
  } finally {
    await t.db.close();
  }
}

async function createHarness(consoleMail: boolean) {
  const db = await openPglite();
  await migrate(db);
  let clock = Date.parse("2030-01-01T00:00:00Z");
  const now = () => clock;
  const mails: Mail[] = [];
  const mail: EmailSender = {
    console: consoleMail,
    async send(message) {
      mails.push(message);
    },
  };
  const ctx = { db, mail, limiter: createRateLimiter(now), now, publicUrl: "http://team.test" };

  const call = async (
    method: string,
    url: string,
    options: { body?: unknown; token?: string; ip?: string; raw?: string } = {},
  ) => {
    const reply = await handleRequest(ctx, {
      method,
      url,
      authorization: options.token ? `Bearer ${options.token}` : undefined,
      body: options.raw ?? (options.body === undefined ? "" : JSON.stringify(options.body)),
      ip: options.ip ?? "10.0.0.1",
    });
    return { status: reply.status, json: reply.json, html: reply.html };
  };

  const signup = async (email: string, name = "Test User", deviceLabel?: string) => {
    const reply = await call("POST", "/v1/auth/signup", {
      body: { email, password: PASSWORD, name, deviceLabel },
    });
    expect(reply.status).toBe(200);
    return reply.json as TeamAuthResult;
  };

  const followLink = (link: string | undefined) => {
    const url = new URL(link ?? "http://invalid");
    return call("GET", url.pathname + url.search);
  };

  /** A signed-in account with a confirmed email. */
  const account = async (email: string, name = "Test User") => {
    const auth = await signup(email, name);
    expect((await followLink(auth.devLink)).status).toBe(200);
    return { token: auth.token, id: auth.user.id, email };
  };

  const me = async (token: string) => (await call("GET", "/v1/me", { token })).json as TeamMe;

  const createOrg = async (token: string, name = "Acme") => {
    const reply = await call("POST", "/v1/orgs", { token, body: { name } });
    expect(reply.status).toBe(200);
    return reply.json as TeamOrganizationDetail;
  };

  const invite = async (token: string, orgId: string, email: string, role = "member") => {
    const reply = await call("POST", `/v1/orgs/${orgId}/invites`, { token, body: { email, role } });
    return { ...reply, result: reply.json as TeamInviteResult };
  };

  /** Invites `email`, creates their account and has them accept. */
  const join = async (owner: string, orgId: string, email: string, role = "member") => {
    const person = await account(email);
    await invite(owner, orgId, email, role);
    const [invitation] = (await me(person.token)).invitations;
    const accepted = await call("POST", `/v1/invitations/${invitation?.id}/accept`, {
      token: person.token,
    });
    expect(accepted.status).toBe(200);
    return person;
  };

  return {
    db,
    mails,
    call,
    signup,
    followLink,
    account,
    me,
    createOrg,
    invite,
    join,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const errorCode = (reply: { json: unknown }) =>
  (reply.json as { error: { code: string } }).error.code;

describe("accounts and sessions", () => {
  it("signs up, signs in, reads the profile and signs out", async () => {
    await withTeam(async (t) => {
      const created = await t.signup("Ada@Example.com", "Ada", "T3 Code on macOS");
      expect(created.user).toMatchObject({ email: "ada@example.com", emailVerified: false });
      const duplicate = await t.call("POST", "/v1/auth/signup", {
        body: { email: "ADA@example.com", password: PASSWORD, name: "Again" },
      });
      expect([duplicate.status, errorCode(duplicate)]).toEqual([409, "email-taken"]);

      const login = await t.call("POST", "/v1/auth/login", {
        body: { email: "ada@example.com", password: PASSWORD, deviceLabel: "Phone" },
      });
      const { token } = login.json as TeamAuthResult;
      expect((await t.me(token)).user.name).toBe("Ada");

      const sessions = (await t.call("GET", "/v1/me/sessions", { token }))
        .json as TeamSessionsResult;
      expect(sessions.sessions.map((s) => [s.label, s.current]).sort()).toEqual([
        ["Phone", true],
        ["T3 Code on macOS", false],
      ]);
      const stored = await t.db.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
      expect(stored.every((row) => row.token_hash !== token && row.token_hash.length === 64)).toBe(
        true,
      );

      expect((await t.call("POST", "/v1/auth/logout", { token })).status).toBe(204);
      expect((await t.call("GET", "/v1/me", { token })).status).toBe(401);
    });
  });

  it("renames the account", async () => {
    await withTeam(async (t) => {
      const ada = await t.account("ada@example.com");
      await t.call("PATCH", "/v1/me", { token: ada.token, body: { name: "  Ada L  " } });
      expect((await t.me(ada.token)).user.name).toBe("Ada L");
    });
  });

  it("answers a wrong password and an unknown email identically", async () => {
    await withTeam(async (t) => {
      await t.signup("ada@example.com");
      const wrong = await t.call("POST", "/v1/auth/login", {
        body: { email: "ada@example.com", password: "not the password" },
      });
      const unknown = await t.call("POST", "/v1/auth/login", {
        body: { email: "nobody@example.com", password: "not the password" },
      });
      expect(wrong).toEqual(unknown);
      expect([wrong.status, errorCode(wrong)]).toEqual([401, "invalid-credentials"]);
    });
  });

  it("rejects weak passwords beyond the length check", async () => {
    await withTeam(async (t) => {
      for (const password of ["password123", "ada.lovelace", "aaaaaaaaaaaa"]) {
        const reply = await t.call("POST", "/v1/auth/signup", {
          body: { email: "ada.lovelace@example.com", password, name: "Ada" },
        });
        expect([reply.status, errorCode(reply)]).toEqual([400, "weak-password"]);
      }
      const short = await t.call("POST", "/v1/auth/signup", {
        body: { email: "ada@example.com", password: "short", name: "Ada" },
      });
      expect(errorCode(short)).toBe("invalid-input");
    });
  });

  it("keeps sessions alive for 30 days from last use", async () => {
    await withTeam(async (t) => {
      const ada = await t.signup("ada@example.com");
      t.advance(20 * DAY);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(200);
      t.advance(20 * DAY);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(200);
      t.advance(31 * DAY);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(401);
    });
  });

  it("throttles lastUsedAt updates and lets a user revoke only their own sessions", async () => {
    await withTeam(async (t) => {
      const ada = await t.signup("ada@example.com");
      const bob = await t.signup("bob@example.com");
      const lastUsed = async () =>
        (await t.db.query<{ last_used_at: Date }>("SELECT last_used_at FROM sessions"))
          .map((row) => row.last_used_at.getTime())
          .sort();
      const before = await lastUsed();
      t.advance(30 * 1000);
      await t.call("GET", "/v1/me", { token: ada.token });
      expect(await lastUsed()).toEqual(before);
      t.advance(31 * 1000);
      await t.call("GET", "/v1/me", { token: ada.token });
      expect(await lastUsed()).not.toEqual(before);

      const bobSession = (
        (await t.call("GET", "/v1/me/sessions", { token: bob.token })).json as TeamSessionsResult
      ).sessions[0];
      const foreign = await t.call("DELETE", `/v1/me/sessions/${bobSession?.id}`, {
        token: ada.token,
      });
      expect(foreign.status).toBe(404);
      const own = await t.call("DELETE", `/v1/me/sessions/${bobSession?.id}`, { token: bob.token });
      expect(own.status).toBe(204);
      expect((await t.call("GET", "/v1/me", { token: bob.token })).status).toBe(401);
    });
  });

  it("changes the password and ends only the other sessions", async () => {
    await withTeam(async (t) => {
      const first = await t.signup("ada@example.com");
      const login = await t.call("POST", "/v1/auth/login", {
        body: { email: "ada@example.com", password: PASSWORD },
      });
      const second = (login.json as TeamAuthResult).token;
      const wrong = await t.call("POST", "/v1/me/password", {
        token: second,
        body: { currentPassword: "nope", newPassword: "a brand new passphrase" },
      });
      expect(errorCode(wrong)).toBe("invalid-credentials");
      const changed = await t.call("POST", "/v1/me/password", {
        token: second,
        body: { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
      });
      expect(changed.status).toBe(204);
      expect((await t.call("GET", "/v1/me", { token: first.token })).status).toBe(401);
      expect((await t.call("GET", "/v1/me", { token: second })).status).toBe(200);
      const relogin = await t.call("POST", "/v1/auth/login", {
        body: { email: "ada@example.com", password: "a brand new passphrase" },
      });
      expect(relogin.status).toBe(200);
    });
  });
});

describe("email links", () => {
  it("verifies an email once and not after it expires", async () => {
    await withTeam(async (t) => {
      const ada = await t.signup("ada@example.com");
      expect(t.mails.at(-1)?.text).toContain("/verify-email?token=");
      const first = await t.followLink(ada.devLink);
      expect(first.status).toBe(200);
      expect((await t.me(ada.token)).user.emailVerified).toBe(true);
      expect((await t.followLink(ada.devLink)).status).toBe(400);

      const bob = await t.signup("bob@example.com");
      t.advance(25 * HOUR);
      expect((await t.followLink(bob.devLink)).status).toBe(400);
      const resent = await t.call("POST", "/v1/auth/resend-verification", { token: bob.token });
      expect((await t.followLink((resent.json as TeamAuthResult).devLink)).status).toBe(200);
    });
  });

  it("resets a password once, within an hour, and signs out every session", async () => {
    await withTeam(async (t) => {
      const ada = await t.signup("ada@example.com");
      const forgot = await t.call("POST", "/v1/auth/forgot-password", {
        body: { email: "ada@example.com" },
      });
      const link = new URL((forgot.json as { devLink: string }).devLink);
      const token = link.searchParams.get("token") ?? "";
      expect((await t.call("GET", link.pathname + link.search)).html).toContain('name="password"');

      const weak = await t.call("POST", "/reset-password", {
        raw: new URLSearchParams({ token, password: "password123" }).toString(),
      });
      expect(weak.status).toBe(400);
      expect(weak.html).toContain('name="password"');

      const reset = await t.call("POST", "/reset-password", {
        raw: new URLSearchParams({ token, password: "a brand new passphrase" }).toString(),
      });
      expect(reset.status).toBe(200);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(401);
      const again = await t.call("POST", "/reset-password", {
        raw: new URLSearchParams({ token, password: "another new passphrase" }).toString(),
      });
      expect(again.status).toBe(400);

      const second = await t.call("POST", "/v1/auth/forgot-password", {
        body: { email: "ada@example.com" },
      });
      t.advance(61 * MINUTE);
      const stale = new URL((second.json as { devLink: string }).devLink);
      expect((await t.call("GET", stale.pathname + stale.search)).status).toBe(400);
    });
  });

  it("does not reveal whether an email has an account", async () => {
    await withTeam(async (t) => {
      await t.signup("ada@example.com");
      t.mails.length = 0;
      const unknown = await t.call("POST", "/v1/auth/forgot-password", {
        body: { email: "nobody@example.com" },
      });
      expect([unknown.status, unknown.json]).toEqual([200, {}]);
      expect(t.mails).toHaveLength(0);
    });
    await withTeam(
      async (t) => {
        const ada = await t.signup("ada@example.com");
        const forgot = await t.call("POST", "/v1/auth/forgot-password", {
          body: { email: "ada@example.com" },
        });
        expect([ada.devLink, forgot.json]).toEqual([undefined, {}]);
      },
      { consoleMail: false },
    );
  });
});

describe("organisations", () => {
  it("needs a verified email to create an organisation", async () => {
    await withTeam(async (t) => {
      const ada = await t.signup("ada@example.com");
      const refused = await t.call("POST", "/v1/orgs", {
        token: ada.token,
        body: { name: "Acme" },
      });
      expect([refused.status, errorCode(refused)]).toEqual([403, "email-not-verified"]);
      await t.followLink(ada.devLink);
      const org = await t.createOrg(ada.token);
      expect(org).toMatchObject({
        role: "owner",
        organization: { memberCount: 1, autoJoinDomain: null },
      });
      expect((await t.me(ada.token)).memberships[0]?.organization.name).toBe("Acme");
    });
  });

  it("enforces the owner, admin and member permission matrix", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const org = await t.createOrg(owner.token);
      const id = org.organization.id;
      const admin = await t.join(owner.token, id, "admin@acme.test", "admin");
      const member = await t.join(owner.token, id, "member@acme.test");
      const second = await t.join(owner.token, id, "second@acme.test");
      const outsider = await t.account("outsider@other.test");

      const status = async (method: string, path: string, token: string, body?: unknown) =>
        (await t.call(method, `/v1/orgs/${id}${path}`, { token, body })).status;

      expect(await status("GET", "", outsider.token)).toBe(404);
      expect(await status("PATCH", "", outsider.token, { name: "X" })).toBe(404);
      expect(await status("DELETE", "", outsider.token)).toBe(404);
      expect(await status("GET", "", member.token)).toBe(200);
      const asMember = (await t.call("GET", `/v1/orgs/${id}`, { token: member.token }))
        .json as TeamOrganizationDetail;
      expect(asMember.invites).toEqual([]);

      expect(await status("PATCH", "", member.token, { name: "X" })).toBe(403);
      expect(await status("PATCH", "", admin.token, { name: "Renamed" })).toBe(200);
      expect(await status("PATCH", "", admin.token, { autoJoinDomain: "acme.test" })).toBe(403);
      expect(
        await status("POST", "/invites", member.token, { email: "x@acme.test", role: "member" }),
      ).toBe(403);
      expect(
        await status("POST", "/invites", admin.token, { email: "x@acme.test", role: "member" }),
      ).toBe(200);

      expect(await status("PATCH", `/members/${member.id}`, admin.token, { role: "admin" })).toBe(
        403,
      );
      expect(await status("PATCH", `/members/${member.id}`, owner.token, { role: "admin" })).toBe(
        200,
      );
      await t.call("PATCH", `/v1/orgs/${id}/members/${member.id}`, {
        token: owner.token,
        body: { role: "member" },
      });

      expect(await status("DELETE", `/members/${owner.id}`, admin.token)).toBe(403);
      expect(await status("DELETE", `/members/${member.id}`, second.token)).toBe(403);
      expect(await status("DELETE", `/members/${member.id}`, admin.token)).toBe(204);
      expect(await status("DELETE", `/members/${second.id}`, owner.token)).toBe(204);
      expect(await status("DELETE", `/members/${admin.id}`, admin.token)).toBe(204);

      expect(await status("DELETE", "", member.token)).toBe(404);
      expect(await status("DELETE", "", owner.token)).toBe(204);
      expect(await status("GET", "", owner.token)).toBe(404);
    });
  });

  it("protects the last owner", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      const id = organization.id;
      const co = await t.join(owner.token, id, "co@acme.test");

      const demote = await t.call("PATCH", `/v1/orgs/${id}/members/${owner.id}`, {
        token: owner.token,
        body: { role: "admin" },
      });
      expect([demote.status, errorCode(demote)]).toEqual([409, "last-owner"]);
      const leave = await t.call("DELETE", `/v1/orgs/${id}/members/${owner.id}`, {
        token: owner.token,
      });
      expect(errorCode(leave)).toBe("last-owner");

      await t.call("PATCH", `/v1/orgs/${id}/members/${co.id}`, {
        token: owner.token,
        body: { role: "owner" },
      });
      const left = await t.call("DELETE", `/v1/orgs/${id}/members/${owner.id}`, {
        token: owner.token,
      });
      expect(left.status).toBe(204);
      const lastLeave = await t.call("DELETE", `/v1/orgs/${id}/members/${co.id}`, {
        token: co.token,
      });
      expect(errorCode(lastLeave)).toBe("last-owner");
    });
  });

  it("deletes an account unless it is the sole owner of an organisation with other members", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      const solo = await t.account("solo@solo.test");
      const soloOrg = await t.createOrg(solo.token, "Solo");

      const wrong = await t.call("POST", "/v1/me/delete", {
        token: owner.token,
        body: { password: "nope" },
      });
      expect(errorCode(wrong)).toBe("invalid-credentials");

      const member = await t.join(owner.token, organization.id, "member@acme.test");
      const blocked = await t.call("POST", "/v1/me/delete", {
        token: owner.token,
        body: { password: PASSWORD },
      });
      expect([blocked.status, errorCode(blocked)]).toEqual([409, "last-owner"]);
      expect((await t.call("GET", "/v1/me", { token: owner.token })).status).toBe(200);

      const aloneGone = await t.call("POST", "/v1/me/delete", {
        token: solo.token,
        body: { password: PASSWORD },
      });
      expect(aloneGone.status).toBe(204);
      const orgs = await t.db.query<{ id: string }>("SELECT id FROM organizations WHERE id = $1", [
        soloOrg.organization.id,
      ]);
      expect(orgs).toHaveLength(0);
      expect((await t.call("GET", "/v1/me", { token: solo.token })).status).toBe(401);

      await t.call("PATCH", `/v1/orgs/${organization.id}/members/${member.id}`, {
        token: owner.token,
        body: { role: "owner" },
      });
      const allowed = await t.call("POST", "/v1/me/delete", {
        token: owner.token,
        body: { password: PASSWORD },
      });
      expect(allowed.status).toBe(204);
      const remaining = (
        await t.call("GET", `/v1/orgs/${organization.id}`, { token: member.token })
      ).json as TeamOrganizationDetail;
      expect(remaining.members.map((m) => m.email)).toEqual(["member@acme.test"]);
    });
  });
});

describe("invitations", () => {
  it("runs the invite, accept and decline lifecycle", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test", "Olivia");
      const { organization } = await t.createOrg(owner.token);
      const id = organization.id;

      const first = await t.invite(owner.token, id, "Guest@Example.com");
      expect(first.result.invite).toMatchObject({
        email: "guest@example.com",
        role: "member",
        invitedByName: "Olivia",
      });
      expect(t.mails.at(-1)?.text).toContain("Olivia invited you to join Acme");
      expect(t.mails.at(-1)?.text).toContain("Settings > Organisation");

      const replaced = await t.invite(owner.token, id, "guest@example.com", "admin");
      expect(replaced.result.invite.id).not.toBe(first.result.invite.id);
      const detail = (await t.call("GET", `/v1/orgs/${id}`, { token: owner.token }))
        .json as TeamOrganizationDetail;
      expect(detail.invites.map((i) => [i.email, i.role])).toEqual([
        ["guest@example.com", "admin"],
      ]);

      const guest = await t.signup("guest@example.com", "Guest");
      expect((await t.me(guest.token)).invitations).toEqual([]);
      const early = await t.call("POST", `/v1/invitations/${replaced.result.invite.id}/accept`, {
        token: guest.token,
      });
      expect([early.status, errorCode(early)]).toEqual([403, "email-not-verified"]);
      await t.followLink(guest.devLink);

      const [invitation] = (await t.me(guest.token)).invitations;
      expect(invitation).toMatchObject({
        organizationName: "Acme",
        invitedByName: "Olivia",
        role: "admin",
      });
      const accepted = await t.call("POST", `/v1/invitations/${invitation?.id}/accept`, {
        token: guest.token,
      });
      expect((accepted.json as TeamOrganizationDetail).role).toBe("admin");
      expect((await t.me(guest.token)).invitations).toEqual([]);

      const again = await t.invite(owner.token, id, "guest@example.com");
      expect([again.status, errorCode(again)]).toEqual([409, "already-member"]);

      const other = await t.invite(owner.token, id, "other@example.com");
      const stranger = await t.account("stranger@example.com");
      const wrongEmail = await t.call("POST", `/v1/invitations/${other.result.invite.id}/accept`, {
        token: stranger.token,
      });
      expect([wrongEmail.status, errorCode(wrongEmail)]).toEqual([403, "forbidden"]);
      const wrongDecline = await t.call(
        "POST",
        `/v1/invitations/${other.result.invite.id}/decline`,
        { token: stranger.token },
      );
      expect(wrongDecline.status).toBe(404);

      const otherAccount = await t.account("other@example.com");
      const decline = await t.call("POST", `/v1/invitations/${other.result.invite.id}/decline`, {
        token: otherAccount.token,
      });
      expect(decline.status).toBe(204);

      const revoked = await t.invite(owner.token, id, "third@example.com");
      const revoke = await t.call("DELETE", `/v1/orgs/${id}/invites/${revoked.result.invite.id}`, {
        token: owner.token,
      });
      expect(revoke.status).toBe(204);
      expect(
        (
          await t.call("DELETE", `/v1/orgs/${id}/invites/${revoked.result.invite.id}`, {
            token: owner.token,
          })
        ).status,
      ).toBe(404);
    });
  });

  it("expires invitations after 14 days", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      const guest = await t.account("guest@example.com");
      const sent = await t.invite(owner.token, organization.id, "guest@example.com");
      t.advance(13 * DAY);
      expect((await t.me(guest.token)).invitations).toHaveLength(1);
      t.advance(2 * DAY);
      expect((await t.me(guest.token)).invitations).toEqual([]);
      const late = await t.call("POST", `/v1/invitations/${sent.result.invite.id}/accept`, {
        token: guest.token,
      });
      expect([late.status, errorCode(late)]).toEqual([410, "invite-expired"]);
    });
  });

  it("needs a verified inviter", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      await t.db.query("UPDATE users SET email_verified = false WHERE id = $1", [owner.id]);
      const refused = await t.invite(owner.token, organization.id, "guest@example.com");
      expect(errorCode(refused)).toBe("email-not-verified");
    });
  });
});

describe("auto-join domains", () => {
  it("claims only the owner's own verified, non-public, unclaimed domain", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      const id = organization.id;
      const admin = await t.join(owner.token, id, "admin@acme.test", "admin");
      const patch = async (token: string, org: string, domain: string | null) =>
        t.call("PATCH", `/v1/orgs/${org}`, { token, body: { autoJoinDomain: domain } });

      expect((await patch(admin.token, id, "acme.test")).status).toBe(403);
      for (const domain of ["other.test", "gmail.com", "not a domain"]) {
        expect(errorCode(await patch(owner.token, id, domain))).toBe("domain-not-allowed");
      }

      const existing = await t.account("early@acme.test");
      await t.signup("unverified@acme.test");
      const set = await patch(owner.token, id, "ACME.test");
      expect((set.json as TeamOrganizationDetail).organization.autoJoinDomain).toBe("acme.test");
      const members = (set.json as TeamOrganizationDetail).members.map((m) => m.email);
      expect(members).toContain("early@acme.test");
      expect(members).not.toContain("unverified@acme.test");
      expect((await t.me(existing.token)).memberships).toHaveLength(1);

      const rival = await t.account("rival@acme.test");
      const rivalOrg = await t.createOrg(rival.token, "Rival");
      expect(errorCode(await patch(rival.token, rivalOrg.organization.id, "acme.test"))).toBe(
        "domain-not-allowed",
      );

      const off = await patch(owner.token, id, null);
      expect((off.json as TeamOrganizationDetail).organization.autoJoinDomain).toBeNull();
      const late = await t.account("late@acme.test");
      expect((await t.me(late.token)).memberships.map((m) => m.organization.name)).toEqual([]);
    });
  });

  it("adds people to the organisation as members when they verify", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      await t.call("PATCH", `/v1/orgs/${organization.id}`, {
        token: owner.token,
        body: { autoJoinDomain: "acme.test" },
      });

      const newcomer = await t.signup("new@acme.test");
      expect((await t.me(newcomer.token)).memberships).toEqual([]);
      await t.followLink(newcomer.devLink);
      const memberships = (await t.me(newcomer.token)).memberships;
      expect(
        memberships.map((m) => [m.organization.name, m.role, m.organization.memberCount]),
      ).toEqual([["Acme", "member", 2]]);
    });
  });
});

describe("rate limiting", () => {
  it("locks sign-in after 10 failures and clears the email's count on success", async () => {
    await withTeam(async (t) => {
      await t.signup("ada@example.com");
      const login = (password: string, ip: string) =>
        t.call("POST", "/v1/auth/login", { body: { email: "ada@example.com", password }, ip });

      for (let i = 0; i < 4; i++) await login("wrong password", "1.1.1.1");
      expect((await login(PASSWORD, "1.1.1.2")).status).toBe(200);
      for (let i = 0; i < 9; i++) await login("wrong password", "1.1.1.3");
      expect((await login(PASSWORD, "1.1.1.4")).status).toBe(200);

      for (let i = 0; i < 10; i++) await login("wrong password", "1.1.1.5");
      const locked = await login(PASSWORD, "1.1.1.6");
      expect([locked.status, errorCode(locked)]).toEqual([429, "rate-limited"]);
      t.advance(16 * MINUTE);
      expect((await login(PASSWORD, "1.1.1.7")).status).toBe(200);
    });
  });

  it("limits sign-ups per IP and reset or verification mail per address", async () => {
    await withTeam(async (t) => {
      const weak = (email: string, ip: string) =>
        t.call("POST", "/v1/auth/signup", {
          body: { email, password: "password123", name: "X" },
          ip,
        });
      for (let i = 0; i < 10; i++)
        expect((await weak(`u${i}@example.com`, "2.2.2.2")).status).toBe(400);
      expect((await weak("u11@example.com", "2.2.2.2")).status).toBe(429);
      expect((await weak("u11@example.com", "2.2.2.3")).status).toBe(400);
      t.advance(61 * MINUTE);
      expect((await weak("u12@example.com", "2.2.2.2")).status).toBe(400);

      const forgot = (ip: string) =>
        t.call("POST", "/v1/auth/forgot-password", { body: { email: "nobody@example.com" }, ip });
      for (let i = 0; i < 5; i++) expect((await forgot(`3.3.3.${i}`)).status).toBe(200);
      expect((await forgot("3.3.3.9")).status).toBe(429);
    });
  });
});

describe("http adapter", () => {
  it("answers CORS preflights, health checks and oversized bodies", async () => {
    const db = await openPglite();
    await migrate(db);
    const now = () => 1_900_000_000_000;
    const server = createTeamServer({
      db,
      mail: { console: true, send: async () => undefined },
      limiter: createRateLimiter(now),
      now,
      publicUrl: "http://team.test",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`;
    try {
      const preflight = await fetch(`${base}/v1/me`, { method: "OPTIONS" });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

      const health = await fetch(`${base}/v1/health`);
      expect(await health.json()).toEqual({ ok: true });
      expect(health.headers.get("cache-control")).toBe("no-store");

      const page = await fetch(`${base}/verify-email?token=nope`);
      expect(page.status).toBe(400);
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");

      const huge = await fetch(`${base}/v1/auth/login`, {
        method: "POST",
        body: "x".repeat(70 * 1024),
      });
      expect(huge.status).toBe(413);

      const missing = await fetch(`${base}/v1/nope`);
      expect(missing.status).toBe(404);
      const badJson = await fetch(`${base}/v1/auth/login`, { method: "POST", body: "{" });
      expect(badJson.status).toBe(400);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  });
});
