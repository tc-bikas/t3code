import type {
  TeamAuthConfig,
  TeamAuthResult,
  TeamConversation,
  TeamConversationsResult,
  TeamEvent,
  TeamMessage,
  TeamMessagesResult,
  TeamUserSearchResult,
  TeamGithubPollResult,
  TeamGithubStartResult,
  TeamInviteResult,
  TeamMe,
  TeamOrganizationDetail,
  TeamSessionsResult,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import type * as NodeNet from "node:net";
import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "./config.ts";
import type { TeamContext } from "./context.ts";
import { openPglite } from "./db.ts";
import { demoReplies, seedDemoPeople } from "./demoPeople.ts";
import { createEventBus } from "./events.ts";
import type { GithubClient, GithubEmail, GithubProfile } from "./github.ts";
import { migrate } from "./migrations.ts";
import { createRateLimiter } from "./rateLimit.ts";
import type { EventStreamOut } from "./http.ts";
import { createTeamServer, handleRequest } from "./server.ts";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

interface FakeGithubUser {
  readonly profile: GithubProfile;
  readonly emails: ReadonlyArray<GithubEmail>;
}

function createFakeGithub() {
  const byCode = new Map<string, FakeGithubUser>();
  const exchanges: Array<{
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }> = [];
  const client: GithubClient = {
    async exchangeCode(input) {
      exchanges.push(input);
      if (!byCode.has(input.code)) throw new Error("bad_verification_code");
      return `token:${input.code}`;
    },
    async fetchProfile(accessToken) {
      const user = byCode.get(accessToken.replace("token:", ""));
      if (!user) throw new Error("bad token");
      return user.profile;
    },
    async fetchEmails(accessToken) {
      const user = byCode.get(accessToken.replace("token:", ""));
      if (!user) throw new Error("bad token");
      return user.emails;
    },
  };
  return { client, exchanges, byCode };
}

interface SignInOptions {
  readonly emails?: ReadonlyArray<GithubEmail>;
  readonly name?: string | null | undefined;
  readonly avatarUrl?: string | null;
  readonly deviceLabel?: string;
}

async function withTeam(
  fn: (t: Awaited<ReturnType<typeof createHarness>>) => Promise<void>,
  options: { configured?: boolean; allowedEmailDomains?: ReadonlyArray<string> } = {},
) {
  const t = await createHarness(options.configured ?? true, options.allowedEmailDomains ?? []);
  try {
    await fn(t);
  } finally {
    await t.db.close();
  }
}

async function createHarness(configured: boolean, allowedEmailDomains: ReadonlyArray<string>) {
  const db = await openPglite();
  await migrate(db);
  let clock = Date.parse("2030-01-01T00:00:00Z");
  const now = () => clock;
  const fake = createFakeGithub();
  const ctx = {
    db,
    github: configured
      ? { clientId: "client-id", clientSecret: "client-secret", client: fake.client }
      : undefined,
    limiter: createRateLimiter(now),
    now,
    publicUrl: "http://team.test",
    allowedEmailDomains,
    events: createEventBus(),
    afterMessage: undefined as TeamContext["afterMessage"],
    every: (_ms: number, fn: () => void) => {
      tickers.add(fn);
      return () => void tickers.delete(fn);
    },
  };
  const tickers = new Set<() => void>();

  const call = async (
    method: string,
    url: string,
    options: { body?: unknown; token?: string; ip?: string } = {},
  ) => {
    const reply = await handleRequest(ctx, {
      method,
      url,
      authorization: options.token ? `Bearer ${options.token}` : undefined,
      body: options.body === undefined ? "" : JSON.stringify(options.body),
      ip: options.ip ?? "10.0.0.1",
    });
    return { status: reply.status, json: reply.json, html: reply.html, stream: reply.stream };
  };

  /** Opens `GET /v1/events` without a socket; `close` plays the client hanging up. */
  const openEvents = async (token: string) => {
    const reply = await call("GET", "/v1/events", { token });
    const chunks: string[] = [];
    const closers: Array<() => void> = [];
    let ended = false;
    const out: EventStreamOut = {
      write: (chunk) => void chunks.push(chunk),
      end: () => {
        ended = true;
        for (const closer of closers) closer();
      },
      onClose: (listener) => void closers.push(listener),
    };
    reply.stream?.(out);
    return {
      status: reply.status,
      chunks,
      events: () =>
        chunks
          .filter((chunk) => chunk.startsWith("data: "))
          .map((chunk) => JSON.parse(chunk.slice(6)) as TeamEvent),
      isEnded: () => ended,
      close: out.end,
    };
  };
  /** Fires the ping timers and lets their session checks settle. */
  const ping = async () => {
    for (const fn of tickers) fn();
    await ctx.db.query("SELECT 1", []);
    await ctx.db.query("SELECT 1", []);
  };

  const startDm = async (token: string, userId: string) => {
    const reply = await call("POST", "/v1/conversations", { token, body: { userId } });
    return { ...reply, conversation: reply.json as TeamConversation };
  };
  const send = async (token: string, conversationId: string, body: string) => {
    const reply = await call("POST", `/v1/conversations/${conversationId}/messages`, {
      token,
      body: { body },
    });
    return { ...reply, message: reply.json as TeamMessage };
  };

  const start = async (deviceLabel?: string) => {
    const reply = await call("POST", "/v1/auth/github/start", { body: { deviceLabel } });
    expect(reply.status).toBe(200);
    return reply.json as TeamGithubStartResult;
  };
  const poll = async (state: string) =>
    (await call("GET", `/v1/auth/github/poll?state=${state}`)).json as TeamGithubPollResult;

  const githubIds = new Map<string, number>();
  const githubUser = (login: string, options: SignInOptions): FakeGithubUser => {
    if (!githubIds.has(login)) githubIds.set(login, githubIds.size + 1000);
    return {
      profile: {
        id: githubIds.get(login) ?? 0,
        login,
        name: options.name === undefined ? login : options.name,
        avatarUrl: options.avatarUrl ?? null,
      },
      emails: options.emails ?? [],
    };
  };

  /** Runs start, the GitHub callback for `login`, and the poll; returns the final poll result. */
  const signInAs = async (login: string, options: SignInOptions = {}) => {
    const { state } = await start(options.deviceLabel);
    const code = `code-${state.slice(0, 8)}`;
    fake.byCode.set(code, githubUser(login, options));
    const page = await call("GET", `/auth/github/callback?code=${code}&state=${state}`);
    return { state, page, result: await poll(state) };
  };

  /** A signed-in account whose only verified GitHub email is `email` (the login derives from it). */
  const account = async (email: string, name?: string) => {
    const login = email.replace(/[@.]/g, "-");
    const { result } = await signInAs(login, {
      name,
      emails: [{ email, primary: true, verified: true }],
    });
    if (result.status !== "complete") throw new Error("sign-in did not complete");
    return { token: result.auth.token, id: result.auth.user.id, email, login };
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

  /** Invites `email`, signs that person in and has them accept. */
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
    ctx,
    db,
    fake,
    call,
    start,
    poll,
    signInAs,
    account,
    me,
    createOrg,
    invite,
    join,
    openEvents,
    ping,
    startDm,
    send,
    tickers,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const errorCode = (reply: { json: unknown }) =>
  (reply.json as { error: { code: string } }).error.code;

describe("GitHub sign-in", () => {
  it("runs start, callback and poll, handing the session out once", async () => {
    await withTeam(async (t) => {
      const started = await t.start("T3 Code on macOS");
      expect(started.state).toMatch(/^[0-9a-f]{64}$/);
      const url = new URL(started.authorizeUrl);
      expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: "client-id",
        redirect_uri: "http://team.test/auth/github/callback",
        scope: "read:user user:email",
        state: started.state,
        code_challenge_method: "S256",
      });
      expect(await t.poll(started.state)).toEqual({ status: "pending" });

      t.fake.byCode.set("the-code", {
        profile: { id: 7, login: "ada", name: "Ada Lovelace", avatarUrl: "https://a/ada.png" },
        emails: [
          { email: "Ada@Acme.test", primary: true, verified: true },
          { email: "unverified@x.test", primary: false, verified: false },
        ],
      });
      const page = await t.call(
        "GET",
        `/auth/github/callback?code=the-code&state=${started.state}`,
      );
      expect(page.status).toBe(200);
      expect(page.html).toContain("You&#39;re signed in. You can close this tab");
      expect(page.html).not.toMatch(/token/i);

      const exchange = t.fake.exchanges[0];
      expect(exchange).toMatchObject({
        clientId: "client-id",
        clientSecret: "client-secret",
        code: "the-code",
        redirectUri: "http://team.test/auth/github/callback",
      });
      expect(url.searchParams.get("code_challenge")).toBe(
        NodeCrypto.createHash("sha256")
          .update(exchange?.codeVerifier ?? "")
          .digest("base64url"),
      );

      const first = await t.poll(started.state);
      expect(first.status).toBe("complete");
      const auth = (first as { auth: TeamAuthResult }).auth;
      expect(auth.user).toMatchObject({
        githubLogin: "ada",
        name: "Ada Lovelace",
        avatarUrl: "https://a/ada.png",
        email: "ada@acme.test",
      });
      expect(await t.poll(started.state)).toMatchObject({ status: "failed" });

      const stored = await t.db.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
      expect(
        stored.every((row) => row.token_hash !== auth.token && row.token_hash.length === 64),
      ).toBe(true);
      const profile = await t.me(auth.token);
      expect(profile.verifiedEmails).toEqual(["ada@acme.test"]);
      const sessions = (await t.call("GET", "/v1/me/sessions", { token: auth.token }))
        .json as TeamSessionsResult;
      expect(sessions.sessions.map((s) => [s.label, s.current])).toEqual([
        ["T3 Code on macOS", true],
      ]);

      expect((await t.call("POST", "/v1/auth/logout", { token: auth.token })).status).toBe(204);
      expect((await t.call("GET", "/v1/me", { token: auth.token })).status).toBe(401);
    });
  });

  it("reports GitHub sign-in as not configured", async () => {
    await withTeam(
      async (t) => {
        const config = await t.call("GET", "/v1/auth/config");
        expect(config.json as TeamAuthConfig).toEqual({ githubConfigured: false });
        const started = await t.call("POST", "/v1/auth/github/start", { body: {} });
        expect([started.status, errorCode(started)]).toEqual([503, "not-configured"]);
      },
      { configured: false },
    );
    await withTeam(async (t) => {
      expect((await t.call("GET", "/v1/auth/config")).json).toEqual({ githubConfigured: true });
    });
  });

  it("fails the attempt when access is denied or the code exchange fails", async () => {
    await withTeam(async (t) => {
      const denied = await t.start();
      const page = await t.call(
        "GET",
        `/auth/github/callback?error=access_denied&state=${denied.state}`,
      );
      expect(page.status).toBe(400);
      expect(await t.poll(denied.state)).toEqual({
        status: "failed",
        message: "GitHub access was denied, so you were not signed in.",
      });
      expect(await t.poll(denied.state)).toMatchObject({ status: "failed" });

      const broken = await t.start();
      const bad = await t.call("GET", `/auth/github/callback?code=unknown&state=${broken.state}`);
      expect(bad.status).toBe(400);
      expect(await t.poll(broken.state)).toMatchObject({ status: "failed" });
      expect(await t.db.query("SELECT 1 FROM users")).toHaveLength(0);
    });
  });

  it("rejects unknown, expired and reused attempts", async () => {
    await withTeam(async (t) => {
      const unknown = await t.call("GET", "/auth/github/callback?code=x&state=nope");
      expect(unknown.status).toBe(400);
      expect(await t.poll("nope")).toMatchObject({ status: "failed" });

      const stale = await t.start();
      t.advance(11 * MINUTE);
      const late = await t.call("GET", `/auth/github/callback?code=x&state=${stale.state}`);
      expect(late.status).toBe(400);
      expect(await t.poll(stale.state)).toMatchObject({ status: "failed" });
      expect(await t.db.query("SELECT 1 FROM github_sign_ins")).toHaveLength(0);

      const { state, result } = await t.signInAs("ada");
      expect(result.status).toBe("complete");
      const replay = await t.call("GET", `/auth/github/callback?code=other&state=${state}`);
      expect(replay.status).toBe(400);
      expect(t.fake.exchanges).toHaveLength(1);

      const expiring = await t.start();
      t.fake.byCode.set("c", {
        profile: { id: 1, login: "x", name: null, avatarUrl: null },
        emails: [],
      });
      await t.call("GET", `/auth/github/callback?code=c&state=${expiring.state}`);
      t.advance(11 * MINUTE);
      expect(await t.poll(expiring.state)).toMatchObject({ status: "failed" });
    });
  });

  it("limits starts per IP", async () => {
    await withTeam(async (t) => {
      for (let i = 0; i < 20; i++) await t.start();
      const refused = await t.call("POST", "/v1/auth/github/start", { body: {} });
      expect(refused.status).toBe(429);
      const other = await t.call("POST", "/v1/auth/github/start", { body: {}, ip: "10.0.0.2" });
      expect(other.status).toBe(200);
      t.advance(11 * MINUTE);
      expect((await t.call("POST", "/v1/auth/github/start", { body: {} })).status).toBe(200);
    });
  });

  it("refreshes the profile and replaces the emails on repeat sign-in", async () => {
    await withTeam(async (t) => {
      const first = await t.signInAs("ada", {
        name: "Ada",
        avatarUrl: "https://a/1.png",
        emails: [
          { email: "ada@old.test", primary: true, verified: true },
          { email: "ada@gmail.com", primary: false, verified: true },
        ],
      });
      const firstAuth = (first.result as { auth: TeamAuthResult }).auth;
      const third = await t.signInAs("ada", {
        avatarUrl: null,
        name: null,
        emails: [{ email: "ada@new.test", primary: false, verified: true }],
      });
      const thirdAuth = (third.result as { auth: TeamAuthResult }).auth;
      expect(thirdAuth.user.id).toBe(firstAuth.user.id);
      expect(thirdAuth.user).toMatchObject({ name: "ada", avatarUrl: null, email: null });
      expect((await t.me(thirdAuth.token)).verifiedEmails).toEqual(["ada@new.test"]);
      expect(await t.db.query("SELECT 1 FROM users")).toHaveLength(1);
      expect(await t.db.query("SELECT 1 FROM sessions")).toHaveLength(2);
    });
  });

  it("keeps sessions alive for 30 days from last use", async () => {
    await withTeam(async (t) => {
      const ada = await t.account("ada@example.com");
      t.advance(20 * DAY);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(200);
      t.advance(20 * DAY);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(200);
      t.advance(31 * DAY);
      expect((await t.call("GET", "/v1/me", { token: ada.token })).status).toBe(401);
    });
  });

  it("renames the account", async () => {
    await withTeam(async (t) => {
      const ada = await t.account("ada@example.com");
      await t.call("PATCH", "/v1/me", { token: ada.token, body: { name: "  Ada L  " } });
      expect((await t.me(ada.token)).user.name).toBe("Ada L");
    });
  });

  it("throttles lastUsedAt updates and lets a user revoke only their own sessions", async () => {
    await withTeam(async (t) => {
      const ada = await t.account("ada@example.com");
      const bob = await t.account("bob@example.com");
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
});

describe("organisations", () => {
  it("creates an organisation with the signed-in user as owner", async () => {
    await withTeam(async (t) => {
      const ada = await t.account("ada@example.com");
      const org = await t.createOrg(ada.token);
      expect(org).toMatchObject({
        role: "owner",
        organization: { memberCount: 1, autoJoinDomain: null },
        members: [{ githubLogin: "ada-example-com", email: "ada@example.com", role: "owner" }],
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

      const member = await t.join(owner.token, organization.id, "member@acme.test");
      const blocked = await t.call("DELETE", "/v1/me", { token: owner.token });
      expect([blocked.status, errorCode(blocked)]).toEqual([409, "last-owner"]);
      expect((await t.call("GET", "/v1/me", { token: owner.token })).status).toBe(200);

      const thread = await t.startDm(solo.token, member.id);
      await t.send(solo.token, thread.conversation.id, "bye");

      const aloneGone = await t.call("DELETE", "/v1/me", { token: solo.token });
      expect(aloneGone.status).toBe(204);
      expect(
        await t.db.query("SELECT 1 FROM conversations WHERE id = $1::uuid", [
          thread.conversation.id,
        ]),
      ).toHaveLength(0);
      expect(
        await t.db.query("SELECT 1 FROM messages WHERE conversation_id = $1::uuid", [
          thread.conversation.id,
        ]),
      ).toHaveLength(0);
      expect((await t.call("GET", "/v1/conversations", { token: member.token })).json).toEqual({
        conversations: [],
      });
      const orgs = await t.db.query<{ id: string }>("SELECT id FROM organizations WHERE id = $1", [
        soloOrg.organization.id,
      ]);
      expect(orgs).toHaveLength(0);
      expect((await t.call("GET", "/v1/me", { token: solo.token })).status).toBe(401);

      await t.call("PATCH", `/v1/orgs/${organization.id}/members/${member.id}`, {
        token: owner.token,
        body: { role: "owner" },
      });
      const allowed = await t.call("DELETE", "/v1/me", { token: owner.token });
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

      const replaced = await t.invite(owner.token, id, "guest@example.com", "admin");
      expect(replaced.result.invite.id).not.toBe(first.result.invite.id);
      const detail = (await t.call("GET", `/v1/orgs/${id}`, { token: owner.token }))
        .json as TeamOrganizationDetail;
      expect(detail.invites.map((i) => [i.email, i.role])).toEqual([
        ["guest@example.com", "admin"],
      ]);

      const guest = await t.account("guest@example.com", "Guest");
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

  it("matches any verified email and never an unverified one", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      const person = await t.signInAs("grace", {
        emails: [
          { email: "grace@home.test", primary: true, verified: true },
          { email: "Grace@Work.test", primary: false, verified: true },
          { email: "grace@claimed.test", primary: false, verified: false },
        ],
      });
      const token = (person.result as { auth: TeamAuthResult }).auth.token;

      await t.invite(owner.token, organization.id, "grace@claimed.test");
      expect((await t.me(token)).invitations).toEqual([]);
      const viaSecond = await t.invite(owner.token, organization.id, "GRACE@work.test");
      const [invitation] = (await t.me(token)).invitations;
      expect(invitation?.id).toBe(viaSecond.result.invite.id);
      const accepted = await t.call("POST", `/v1/invitations/${invitation?.id}/accept`, { token });
      expect(accepted.status).toBe(200);

      const again = await t.invite(owner.token, organization.id, "grace@home.test");
      expect(errorCode(again)).toBe("already-member");
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
});

describe("auto-join domains", () => {
  it("claims only the owner's own verified, non-public, unclaimed domain", async () => {
    await withTeam(async (t) => {
      const owner = await t.signInAs("owner", {
        emails: [
          { email: "owner@acme.test", primary: true, verified: true },
          { email: "owner@gmail.com", primary: false, verified: true },
        ],
      });
      const ownerAuth = (owner.result as { auth: TeamAuthResult }).auth;
      const { organization } = await t.createOrg(ownerAuth.token);
      const id = organization.id;
      const admin = await t.join(ownerAuth.token, id, "admin@acme.test", "admin");
      const patch = async (token: string, org: string, domain: string | null) =>
        t.call("PATCH", `/v1/orgs/${org}`, { token, body: { autoJoinDomain: domain } });

      expect((await patch(admin.token, id, "acme.test")).status).toBe(403);
      for (const domain of ["other.test", "gmail.com", "not a domain"]) {
        expect(errorCode(await patch(ownerAuth.token, id, domain))).toBe("domain-not-allowed");
      }

      const existing = await t.account("early@acme.test");
      await t.signInAs("unverified", {
        emails: [{ email: "unverified@acme.test", primary: true, verified: false }],
      });
      const set = await patch(ownerAuth.token, id, "ACME.test");
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

      const off = await patch(ownerAuth.token, id, null);
      expect((off.json as TeamOrganizationDetail).organization.autoJoinDomain).toBeNull();
      const late = await t.account("late@acme.test");
      expect((await t.me(late.token)).memberships.map((m) => m.organization.name)).toEqual([]);
    });
  });

  it("joins people through any verified email as members, never on a public domain", async () => {
    await withTeam(async (t) => {
      const owner = await t.account("owner@acme.test");
      const { organization } = await t.createOrg(owner.token);
      await t.call("PATCH", `/v1/orgs/${organization.id}`, {
        token: owner.token,
        body: { autoJoinDomain: "acme.test" },
      });

      const viaSecond = await t.signInAs("newbie", {
        emails: [
          { email: "newbie@gmail.com", primary: true, verified: true },
          { email: "newbie@acme.test", primary: false, verified: true },
        ],
      });
      const auth = (viaSecond.result as { auth: TeamAuthResult }).auth;
      expect(
        (await t.me(auth.token)).memberships.map((m) => [
          m.organization.name,
          m.role,
          m.organization.memberCount,
        ]),
      ).toEqual([["Acme", "member", 2]]);

      const unverified = await t.signInAs("sneaky", {
        emails: [{ email: "sneaky@acme.test", primary: true, verified: false }],
      });
      const sneaky = (unverified.result as { auth: TeamAuthResult }).auth;
      expect((await t.me(sneaky.token)).memberships).toEqual([]);

      // A public provider can never be claimed, so a gmail address never joins anything.
      await t.db.query("UPDATE organizations SET auto_join_domain = 'gmail.com' WHERE id = $1", [
        organization.id,
      ]);
      const gmail = await t.account("someone@gmail.com");
      expect((await t.me(gmail.token)).memberships).toEqual([]);
    });
  });
});

describe("http adapter", () => {
  it("answers CORS preflights, health checks, callback pages and oversized bodies", async () => {
    const db = await openPglite();
    await migrate(db);
    const now = () => 1_900_000_000_000;
    const server = createTeamServer({
      db,
      github: undefined,
      limiter: createRateLimiter(now),
      now,
      publicUrl: "http://team.test",
      allowedEmailDomains: [],
      events: createEventBus(),
      every: () => () => undefined,
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

      const page = await fetch(`${base}/auth/github/callback?code=x&state=nope`);
      expect(page.status).toBe(400);
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");

      const huge = await fetch(`${base}/v1/auth/github/start`, {
        method: "POST",
        body: "x".repeat(70 * 1024),
      });
      expect(huge.status).toBe(413);

      const missing = await fetch(`${base}/v1/nope`);
      expect(missing.status).toBe(404);
      const badJson = await fetch(`${base}/v1/auth/github/start`, { method: "POST", body: "{" });
      expect(badJson.status).toBe(400);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  });
});

describe("direct messages", () => {
  const people = async (t: Awaited<ReturnType<typeof createHarness>>) => ({
    ann: await t.account("ann@x.test", "Ann Lee"),
    bob: await t.account("bob@x.test", "Bob Ray"),
    cat: await t.account("cat@x.test", "Cat Fox"),
  });

  it("lets the demo teammates be found and answer a real person", async () => {
    await withTeam(async (t) => {
      const ann = await t.account("ann@x.test", "Ann Lee");
      const demo = await seedDemoPeople(t.ctx);
      const replies: Array<() => Promise<unknown>> = [];
      t.ctx.afterMessage = demoReplies(t.ctx, demo, (fn) => void replies.push(fn));
      const found = (
        (await t.call("GET", "/v1/users/search?q=ada-demo", { token: ann.token }))
          .json as TeamUserSearchResult
      ).users;
      expect(found.map((u) => u.githubLogin)).toEqual(["ada-demo"]);
      const conversation = (
        await t.call("POST", "/v1/conversations", {
          token: ann.token,
          body: { userId: found[0]?.id },
        })
      ).json as TeamConversation;
      await t.call("POST", `/v1/conversations/${conversation.id}/messages`, {
        token: ann.token,
        body: { body: "hello" },
      });
      expect(replies).toHaveLength(1);
      await replies[0]?.();
      const history = (
        await t.call("GET", `/v1/conversations/${conversation.id}/messages`, { token: ann.token })
      ).json as TeamMessagesResult;
      expect(history.messages.map((m) => m.senderId)).toEqual([ann.id, found[0]?.id]);
      expect(replies).toHaveLength(1);
    });
  });

  it("searches by login or name, excluding the caller", async () => {
    await withTeam(async (t) => {
      const { ann, bob } = await people(t);
      const search = async (q: string) =>
        (await t.call("GET", `/v1/users/search?q=${encodeURIComponent(q)}`, { token: ann.token }))
          .json as TeamUserSearchResult;
      expect((await search("bob")).users.map((u) => u.id)).toEqual([bob.id]);
      expect((await search("  RAY ")).users.map((u) => u.githubLogin)).toEqual([bob.login]);
      expect((await search("x-test")).users.map((u) => u.githubLogin)).toEqual([
        bob.login,
        "cat-x-test",
      ]);
      expect((await search("ann")).users).toEqual([]);
      expect((await search("b")).users).toEqual([]);
      expect((await search("%%")).users).toEqual([]);
      expect((await search("x".repeat(51))).users).toEqual([]);
      expect((await t.call("GET", "/v1/users/search?q=bob")).status).toBe(401);

      for (let i = 0; i < 12; i++) await t.account(`many${i}@x.test`);
      expect((await search("many")).users).toHaveLength(10);
    });
  });

  it("starts one conversation per pair from either side and under a race", async () => {
    await withTeam(async (t) => {
      const { ann, bob } = await people(t);
      const [one, two] = await Promise.all([
        t.startDm(ann.token, bob.id),
        t.startDm(bob.token, ann.id),
      ]);
      expect(one.conversation.id).toBe(two.conversation.id);
      expect(one.conversation.peer.id).toBe(bob.id);
      expect(two.conversation.peer.id).toBe(ann.id);
      expect(one.conversation).toMatchObject({ lastMessage: null, unreadCount: 0 });
      const again = await t.startDm(ann.token, bob.id);
      expect(again.conversation.id).toBe(one.conversation.id);
      expect(await t.db.query("SELECT 1 FROM conversations")).toHaveLength(1);

      expect(errorCode(await t.startDm(ann.token, ann.id))).toBe("invalid-input");
      expect(errorCode(await t.startDm(ann.token, "nobody"))).toBe("not-found");
    });
  });

  it("sends, lists and pages messages", async () => {
    await withTeam(async (t) => {
      const { ann, bob, cat } = await people(t);
      const { conversation } = await t.startDm(ann.token, bob.id);
      const id = conversation.id;
      const sent: TeamMessage[] = [];
      for (let i = 1; i <= 5; i++)
        sent.push((await t.send(i % 2 ? ann.token : bob.token, id, `  m${i} `)).message);
      expect(sent.map((m) => m.body)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      expect(sent[0]).toMatchObject({ conversationId: id, senderId: ann.id });

      const page = async (query: string) =>
        (await t.call("GET", `/v1/conversations/${id}/messages${query}`, { token: bob.token }))
          .json as TeamMessagesResult;
      expect((await page("")).messages.map((m) => m.body)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      const newest = await page("?limit=2");
      expect(newest.messages.map((m) => m.body)).toEqual(["m4", "m5"]);
      expect(newest.hasMore).toBe(true);
      const older = await page(`?limit=2&before=${newest.messages[0]?.id}`);
      expect(older.messages.map((m) => m.body)).toEqual(["m2", "m3"]);
      const oldest = await page(`?limit=2&before=${older.messages[0]?.id}`);
      expect([oldest.messages.map((m) => m.body), oldest.hasMore]).toEqual([["m1"], false]);

      const reply = await t.call("GET", `/v1/conversations/${id}/messages?limit=101`, {
        token: bob.token,
      });
      expect(errorCode(reply)).toBe("invalid-input");
      expect(errorCode(await t.send(ann.token, id, "   "))).toBe("invalid-input");
      expect(errorCode(await t.send(ann.token, id, "x".repeat(4001)))).toBe("invalid-input");

      const list = (await t.call("GET", "/v1/conversations", { token: ann.token }))
        .json as TeamConversationsResult;
      expect(list.conversations).toHaveLength(1);
      expect(list.conversations[0]?.lastMessage?.body).toBe("m5");

      const other = await t.startDm(ann.token, cat.id);
      t.advance(1000);
      await t.send(ann.token, other.conversation.id, "hi cat");
      const ordered = (await t.call("GET", "/v1/conversations", { token: ann.token }))
        .json as TeamConversationsResult;
      expect(ordered.conversations.map((c) => c.peer.id)).toEqual([cat.id, bob.id]);
    });
  });

  it("shows a conversation only to its two participants", async () => {
    await withTeam(async (t) => {
      const { ann, bob, cat } = await people(t);
      const { conversation } = await t.startDm(ann.token, bob.id);
      const sent = (await t.send(ann.token, conversation.id, "secret")).message;
      const base = `/v1/conversations/${conversation.id}`;
      const status = async (method: string, path: string, body?: unknown) => {
        const reply = await t.call(method, `${base}${path}`, { token: cat.token, body });
        return [reply.status, errorCode(reply)];
      };
      expect(await status("GET", "/messages")).toEqual([404, "not-found"]);
      expect(await status("POST", "/messages", { body: "hi" })).toEqual([404, "not-found"]);
      expect(await status("POST", "/read", { upToMessageId: sent.id })).toEqual([404, "not-found"]);
      expect((await t.call("GET", "/v1/conversations", { token: cat.token })).json).toEqual({
        conversations: [],
      });
      const bogus = await t.call("GET", "/v1/conversations/not-a-uuid/messages", {
        token: ann.token,
      });
      expect(bogus.status).toBe(404);
    });
  });

  it("counts unread messages and only moves the read marker forward", async () => {
    await withTeam(async (t) => {
      const { ann, bob, cat } = await people(t);
      const { conversation } = await t.startDm(ann.token, bob.id);
      const id = conversation.id;
      const m1 = (await t.send(ann.token, id, "1")).message;
      const m2 = (await t.send(ann.token, id, "2")).message;
      const m3 = (await t.send(ann.token, id, "3")).message;
      await t.send(bob.token, id, "reply");
      const unread = async (token: string) =>
        ((await t.call("GET", "/v1/conversations", { token })).json as TeamConversationsResult)
          .conversations[0]?.unreadCount;
      expect([await unread(bob.token), await unread(ann.token)]).toEqual([3, 1]);

      const read = (token: string, upToMessageId: string) =>
        t.call("POST", `/v1/conversations/${id}/read`, { token, body: { upToMessageId } });
      expect((await read(bob.token, m2.id)).status).toBe(204);
      expect(await unread(bob.token)).toBe(1);
      await read(bob.token, m1.id);
      expect(await unread(bob.token)).toBe(1);
      await read(bob.token, m3.id);
      expect(await unread(bob.token)).toBe(0);

      const elsewhere = await t.startDm(ann.token, cat.id);
      const foreign = (await t.send(cat.token, elsewhere.conversation.id, "x")).message;
      await read(ann.token, foreign.id);
      expect(await unread(ann.token)).toBe(1);
      expect((await read(bob.token, "abc")).status).toBe(400);
    });
  });

  it("limits sending to 30 messages a minute per user", async () => {
    await withTeam(async (t) => {
      const { ann, bob } = await people(t);
      const { conversation } = await t.startDm(ann.token, bob.id);
      for (let i = 0; i < 30; i++)
        expect((await t.send(ann.token, conversation.id, "x")).status).toBe(200);
      const limited = await t.send(ann.token, conversation.id, "x");
      expect([limited.status, errorCode(limited)]).toEqual([429, "rate-limited"]);
      expect((await t.send(bob.token, conversation.id, "still fine")).status).toBe(200);
      t.advance(61 * 1000);
      expect((await t.send(ann.token, conversation.id, "x")).status).toBe(200);
    });
  });

  it("streams events to both people with their own unread counts, and read to the reader", async () => {
    await withTeam(async (t) => {
      const { ann, bob, cat } = await people(t);
      const annPhone = await t.openEvents(ann.token);
      const annLaptop = await t.openEvents(ann.token);
      const bobStream = await t.openEvents(bob.token);
      const catStream = await t.openEvents(cat.token);
      const { conversation } = await t.startDm(ann.token, bob.id);

      const message = (await t.send(ann.token, conversation.id, "hello")).message;
      const [forAnn] = annPhone.events();
      const [forBob] = bobStream.events();
      expect(forAnn).toMatchObject({ type: "message", message });
      expect(forBob).toMatchObject({ type: "message", message });
      if (forAnn?.type !== "message" || forBob?.type !== "message") throw new Error("no message");
      expect([forAnn.conversation.peer.id, forAnn.conversation.unreadCount]).toEqual([bob.id, 0]);
      expect([forBob.conversation.peer.id, forBob.conversation.unreadCount]).toEqual([ann.id, 1]);
      expect(annLaptop.events()).toHaveLength(1);
      expect(catStream.events()).toEqual([]);

      await t.call("POST", `/v1/conversations/${conversation.id}/read`, {
        token: bob.token,
        body: { upToMessageId: message.id },
      });
      expect(bobStream.events().at(-1)).toEqual({ type: "read", conversationId: conversation.id });
      expect(annPhone.events()).toHaveLength(1);
    });
  });

  it("pings on the injected timer, ends on a revoked session, and cleans up on close", async () => {
    await withTeam(async (t) => {
      const { ann, bob } = await people(t);
      const stream = await t.openEvents(ann.token);
      expect(stream.status).toBe(200);
      expect(t.tickers.size).toBe(1);
      await t.ping();
      expect(stream.chunks.at(-1)).toBe(": ping\n\n");
      expect(stream.isEnded()).toBe(false);

      const sessions = (await t.call("GET", "/v1/me/sessions", { token: ann.token }))
        .json as TeamSessionsResult;
      await t.db.query("DELETE FROM sessions WHERE id = $1", [sessions.sessions[0]?.id]);
      await t.ping();
      expect(stream.isEnded()).toBe(true);
      expect(t.tickers.size).toBe(0);

      const second = await t.openEvents(bob.token);
      second.close();
      expect(t.tickers.size).toBe(0);
      expect((await t.call("GET", "/v1/events")).status).toBe(401);
    });
  });
});

describe("demo teammates config", () => {
  it("only runs on the embedded database and a loopback host", () => {
    expect(loadConfig({ TEAM_DEMO_PEOPLE: "1" }, "/tmp").demoPeople).toBe(true);
    expect(() =>
      loadConfig({ TEAM_DEMO_PEOPLE: "1", DATABASE_URL: "postgres://x" }, "/tmp"),
    ).toThrow();
    expect(() => loadConfig({ TEAM_DEMO_PEOPLE: "1", TEAM_HOST: "0.0.0.0" }, "/tmp")).toThrow();
  });
});

describe("allowed email domains", () => {
  it("lets in only people with a verified email at an allowed domain", async () => {
    await withTeam(
      async (t) => {
        const ok = await t.signInAs("ok", {
          emails: [
            { email: "x@gmail.com", primary: true, verified: true },
            { email: "Me@Together.TEST", primary: false, verified: true },
          ],
        });
        expect(ok.result.status).toBe("complete");

        const unverified = await t.signInAs("unverified", {
          emails: [{ email: "u@together.test", primary: true, verified: false }],
        });
        expect(unverified.result).toEqual({
          status: "failed",
          message:
            "Add and verify an email at one of: together.test, other.test on your GitHub account, then try again.",
        });
        expect(
          await t.db.query("SELECT 1 FROM users WHERE github_login = 'unverified'"),
        ).toHaveLength(0);
        expect((await t.signInAs("none")).result.status).toBe("failed");
      },
      { allowedEmailDomains: ["together.test", "other.test"] },
    );
  });

  it("refuses sign-in and revokes sessions of people who stop qualifying", async () => {
    await withTeam(
      async (t) => {
        const person = await t.account("old@together.test");
        const other = await t.account("other@together.test");
        expect((await t.call("GET", "/v1/me", { token: person.token })).status).toBe(200);

        const lost = await t.signInAs(person.login, {
          emails: [{ email: "old@gmail.com", primary: true, verified: true }],
        });
        expect(lost.result.status).toBe("failed");
        expect((await t.call("GET", "/v1/me", { token: person.token })).status).toBe(401);

        await t.db.query("DELETE FROM user_emails WHERE user_id = $1", [other.id]);
        expect((await t.call("GET", "/v1/me", { token: other.token })).status).toBe(401);
      },
      { allowedEmailDomains: ["together.test"] },
    );
  });
});
