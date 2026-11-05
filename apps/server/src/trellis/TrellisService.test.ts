import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Deferred from "effect/Deferred";
import * as Digest from "effect/crypto/Digest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as TrellisService from "./TrellisService.ts";

const ENV = {
  T3CODE_TRELLIS_CLIENT_ID: "client-id-1",
  T3CODE_TRELLIS_CLIENT_SECRET: "client-secret-1",
  T3CODE_TRELLIS_WORKSPACE: "acme",
};
const ORIGIN = "http://127.0.0.1:3773";

interface Recorded {
  readonly url: string;
  readonly query: URLSearchParams;
  readonly authorization: string | undefined;
  readonly params: URLSearchParams;
}
interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

const grant = (n: number): Reply => ({
  status: 200,
  body: {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_in: 3600,
    token_type: "Bearer",
  },
});
const oauthError = (error: string): Reply => ({ status: 400, body: { error } });
const isTokenCall = (request: Recorded) => request.url.endsWith("/oauth/token");
const grantType = (request: Recorded) => request.params.get("grant_type");

const harness = (input: {
  readonly env?: Record<string, string>;
  readonly respond: (request: Recorded) => Effect.Effect<Reply>;
}) => {
  const requests: Array<Recorded> = [];
  const stored = new Map<string, Uint8Array>();
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const recorded: Recorded = {
          url: request.url,
          query: new URLSearchParams(UrlParams.toString(request.urlParams)),
          authorization: request.headers["authorization"],
          params: new URLSearchParams(
            request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
          ),
        };
        requests.push(recorded);
        const reply = yield* input.respond(recorded);
        return HttpClientResponse.fromWeb(
          request,
          new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
            status: reply.status,
            headers: { "content-type": "application/json", ...reply.headers },
          }),
        );
      }),
    ),
  );
  const secrets = Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: (name) => Effect.sync(() => Option.fromNullishOr(stored.get(name))),
    set: (name, value) =>
      Effect.sync(() => {
        stored.set(name, value);
      }),
    remove: (name) =>
      Effect.sync(() => {
        stored.delete(name);
      }),
  });
  return {
    requests,
    stored,
    provide: Effect.provide(
      Layer.mergeAll(
        TrellisService.layer.pipe(Layer.provide(Layer.mergeAll(http, secrets, NodeCrypto.layer))),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? ENV })),
        NodeCrypto.layer,
      ),
    ),
  };
};

const connect = Effect.gen(function* () {
  const trellis = yield* TrellisService.TrellisService;
  const { authorizeUrl } = yield* trellis.startConnect({ origin: ORIGIN });
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  yield* trellis.completeConnect({ state, code: "code-1" });
  return { trellis, authorizeUrl, state };
});

const storedRefreshToken = (stored: Map<string, Uint8Array>) => {
  const bytes = stored.get("trellis-connection");
  return bytes === undefined
    ? undefined
    : (JSON.parse(new TextDecoder().decode(bytes)) as { refreshToken: string }).refreshToken;
};

const apiReply = (request: Recorded): Reply =>
  request.url.endsWith("/app")
    ? { status: 200, body: { workspace_name: "Acme Ltd" } }
    : {
        status: 200,
        body: [
          {
            id: "i1",
            code: "WEB-12",
            title: "Fix the thing",
            status_name: "In progress",
            project_key: "WEB",
            project_name: "Website",
          },
        ],
      };

describe("trellisRedirectUri", () => {
  it("accepts only http loopback origins on a registered hostname and keeps the port", () => {
    const cases: ReadonlyArray<readonly [string, string | undefined]> = [
      ["http://127.0.0.1:3773", "http://127.0.0.1:3773/oauth/trellis/callback"],
      ["http://localhost:5733", "http://localhost:5733/oauth/trellis/callback"],
      ["https://app.t3.codes", undefined],
      ["http://192.168.1.4:3773", undefined],
      ["https://localhost:3773", undefined],
      ["http://[::1]:3773", undefined],
      ["not a url", undefined],
    ];
    for (const [origin, expected] of cases) {
      assert.equal(TrellisService.trellisRedirectUri(origin), expected, origin);
    }
  });
});

describe("TrellisService", () => {
  it.effect(
    "connects with PKCE, exchanges the code with Basic auth, and saves the refresh token",
    () => {
      const h = harness({
        respond: (request) => Effect.succeed(isTokenCall(request) ? grant(1) : apiReply(request)),
      });
      return Effect.gen(function* () {
        const digest = yield* Digest.Digest;
        const { trellis, authorizeUrl, state } = yield* connect;

        const authorize = new URL(authorizeUrl);
        assert.equal(
          authorize.origin + authorize.pathname,
          "https://beta.trellisapp.co.uk/oauth/authorize",
        );
        assert.equal(authorize.searchParams.get("response_type"), "code");
        assert.equal(authorize.searchParams.get("client_id"), "client-id-1");
        assert.equal(
          authorize.searchParams.get("redirect_uri"),
          "http://127.0.0.1:3773/oauth/trellis/callback",
        );
        assert.equal(
          authorize.searchParams.get("scope"),
          "workspace:read projects:read issues:read",
        );
        assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
        assert.equal(authorize.searchParams.get("state"), state);

        const exchange = h.requests.find(isTokenCall)!;
        assert.equal(exchange.authorization, `Basic ${btoa("client-id-1:client-secret-1")}`);
        assert.equal(grantType(exchange), "authorization_code");
        assert.equal(exchange.params.get("code"), "code-1");
        assert.equal(
          exchange.params.get("redirect_uri"),
          "http://127.0.0.1:3773/oauth/trellis/callback",
        );
        const verifier = exchange.params.get("code_verifier")!;
        assert.equal(
          Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier))),
          authorize.searchParams.get("code_challenge"),
        );
        assert.equal(storedRefreshToken(h.stored), "refresh-1");

        const status = yield* trellis.status;
        assert.deepEqual(status, {
          state: "connected",
          workspaceHandle: "acme",
          workspaceName: "Acme Ltd",
        });
        const serialized = JSON.stringify(status);
        for (const secret of ["client-secret-1", "refresh-1", "access-1", verifier]) {
          assert.notInclude(serialized, secret);
        }
      }).pipe(h.provide);
    },
  );

  it.effect("names the missing variables, never their values, and refuses to start", () => {
    const h = harness({
      env: { T3CODE_TRELLIS_CLIENT_ID: "client-id-1" },
      respond: () => Effect.die("no request expected"),
    });
    return Effect.gen(function* () {
      const trellis = yield* TrellisService.TrellisService;
      const status = yield* trellis.status;
      assert.equal(status.state, "not-configured");
      const message = status.state === "not-configured" ? status.message : "";
      assert.include(message, "T3CODE_TRELLIS_CLIENT_SECRET");
      assert.include(message, "T3CODE_TRELLIS_WORKSPACE");
      assert.notInclude(message, "client-id-1");
      const failure = yield* trellis.startConnect({ origin: ORIGIN }).pipe(Effect.flip);
      assert.equal(failure.reason, "not-configured");
      assert.lengthOf(h.requests, 0);
    }).pipe(h.provide);
  });

  it.effect("refuses an origin Trellis cannot redirect back to", () => {
    const h = harness({ respond: () => Effect.die("no request expected") });
    return Effect.gen(function* () {
      const trellis = yield* TrellisService.TrellisService;
      const failure = yield* trellis
        .startConnect({ origin: "https://app.t3.codes" })
        .pipe(Effect.flip);
      assert.equal(failure.reason, "unsupported-origin");
      assert.include(failure.detail, "same computer");
    }).pipe(h.provide);
  });

  it.effect("rejects an unknown, reused, or expired state without calling Trellis", () => {
    const h = harness({
      respond: (request) => Effect.succeed(isTokenCall(request) ? grant(1) : apiReply(request)),
    });
    return Effect.gen(function* () {
      const trellis = yield* TrellisService.TrellisService;
      const reason = (state: string) =>
        trellis.completeConnect({ state, code: "code-1" }).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        );
      assert.equal(yield* reason("not-a-known-state"), "invalid-state");

      const first = yield* trellis.startConnect({ origin: ORIGIN });
      const firstState = new URL(first.authorizeUrl).searchParams.get("state")!;
      yield* trellis.completeConnect({ state: firstState, code: "code-1" });
      assert.equal(yield* reason(firstState), "invalid-state");

      const second = yield* trellis.startConnect({ origin: ORIGIN });
      const secondState = new URL(second.authorizeUrl).searchParams.get("state")!;
      yield* TestClock.adjust(Duration.minutes(11));
      assert.equal(yield* reason(secondState), "invalid-state");
      assert.lengthOf(h.requests.filter(isTokenCall), 1);
    }).pipe(h.provide);
  });

  it.effect("consumes the attempt when the admin denies access", () => {
    const h = harness({ respond: () => Effect.die("no request expected") });
    return Effect.gen(function* () {
      const trellis = yield* TrellisService.TrellisService;
      const { authorizeUrl } = yield* trellis.startConnect({ origin: ORIGIN });
      const state = new URL(authorizeUrl).searchParams.get("state")!;
      const denied = yield* trellis
        .completeConnect({ state, error: "access_denied" })
        .pipe(Effect.flip);
      assert.equal(denied.reason, "denied");
      const reused = yield* trellis.completeConnect({ state, code: "late" }).pipe(Effect.flip);
      assert.equal(reused.reason, "invalid-state");
      assert.lengthOf(h.requests, 0);
    }).pipe(h.provide);
  });

  it.effect("turns token rejections into messages that carry no credentials", () => {
    const h = harness({ respond: () => Effect.succeed(oauthError("unauthorized_client")) });
    return Effect.gen(function* () {
      const trellis = yield* TrellisService.TrellisService;
      const { authorizeUrl } = yield* trellis.startConnect({ origin: ORIGIN });
      const state = new URL(authorizeUrl).searchParams.get("state")!;
      const failure = yield* trellis.completeConnect({ state, code: "code-1" }).pipe(Effect.flip);
      assert.equal(failure.reason, "denied");
      const serialized = JSON.stringify(failure);
      for (const secret of [
        "client-secret-1",
        "code-1",
        h.requests[0]!.params.get("code_verifier")!,
      ]) {
        assert.notInclude(serialized, secret);
      }
      assert.equal((yield* trellis.status).state, "disconnected");
    }).pipe(h.provide);
  });

  it.effect("refreshes once for concurrent searches and saves the rotated pair", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const h = harness({
        respond: (request) =>
          Effect.gen(function* () {
            if (!isTokenCall(request)) return apiReply(request);
            if (grantType(request) === "authorization_code") return grant(1);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(gate);
            return grant(2);
          }),
      });
      yield* Effect.gen(function* () {
        const { trellis } = yield* connect;
        yield* TestClock.adjust(Duration.hours(2));
        const searches = yield* Effect.all(
          [trellis.searchIssues({ query: "fix" }), trellis.searchIssues({ query: "thing" })],
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Deferred.succeed(gate, undefined);
        const [first, second] = yield* Fiber.join(searches);

        assert.deepEqual(first.issues, [
          {
            id: "i1",
            code: "WEB-12",
            title: "Fix the thing",
            statusName: "In progress",
            projectName: "Website",
            url: "https://beta.trellisapp.co.uk/acme/projects/WEB/tasks?code=WEB-12",
          },
        ]);
        assert.equal(second.issues.length, 1);
        assert.lengthOf(
          h.requests.filter((r) => isTokenCall(r) && grantType(r) === "refresh_token"),
          1,
        );
        const searchCalls = h.requests.filter((r) => r.url.includes("/issues/search"));
        assert.deepEqual(
          searchCalls.map((r) => r.authorization),
          ["Bearer access-2", "Bearer access-2"],
        );
        assert.equal(storedRefreshToken(h.stored), "refresh-2");
      }).pipe(h.provide);
    }),
  );

  it.effect("searches with the query and limit and reuses a live access token", () => {
    const h = harness({
      respond: (request) => Effect.succeed(isTokenCall(request) ? grant(1) : apiReply(request)),
    });
    return Effect.gen(function* () {
      const { trellis } = yield* connect;
      yield* trellis.searchIssues({ query: " fix ", limit: 5 });
      yield* trellis.searchIssues({ query: "" });
      const [withQuery, withoutQuery] = h.requests.filter((r) => r.url.includes("/issues/search"));
      assert.equal(new URL(withQuery!.url).pathname, "/api/v1/workspace/acme/issues/search");
      assert.equal(withQuery!.query.get("q"), "fix");
      assert.equal(withQuery!.query.get("limit"), "5");
      assert.equal(withoutQuery!.query.get("q"), null);
      assert.lengthOf(h.requests.filter(isTokenCall), 1);
    }).pipe(h.provide);
  });

  it.effect("goes back to disconnected when Trellis rejects the refresh token", () => {
    const h = harness({
      respond: (request) =>
        Effect.succeed(
          !isTokenCall(request)
            ? apiReply(request)
            : grantType(request) === "authorization_code"
              ? grant(1)
              : oauthError("invalid_grant"),
        ),
    });
    return Effect.gen(function* () {
      const { trellis } = yield* connect;
      yield* TestClock.adjust(Duration.hours(2));
      const failure = yield* trellis.searchIssues({ query: "x" }).pipe(Effect.flip);
      assert.equal(failure.reason, "reconnect-required");
      assert.equal(storedRefreshToken(h.stored), undefined);
      assert.deepEqual(yield* trellis.status, { state: "disconnected" });
    }).pipe(h.provide);
  });

  it.effect("asks for a reconnect after a second 401 and explains rate limits", () => {
    let mode: "unauthorized" | "limited" = "unauthorized";
    const h = harness({
      respond: (request) =>
        Effect.succeed(
          isTokenCall(request)
            ? grant(request.params.get("grant_type") === "refresh_token" ? 2 : 1)
            : mode === "unauthorized"
              ? { status: 401 }
              : { status: 429, headers: { "retry-after": "30" } },
        ),
    });
    return Effect.gen(function* () {
      const { trellis } = yield* connect;
      const unauthorized = yield* trellis.searchIssues({ query: "x" }).pipe(Effect.flip);
      assert.equal(unauthorized.reason, "reconnect-required");
      assert.lengthOf(
        h.requests.filter((r) => grantType(r) === "refresh_token"),
        1,
      );
      assert.equal(storedRefreshToken(h.stored), "refresh-2");

      mode = "limited";
      const limited = yield* trellis.searchIssues({ query: "x" }).pipe(Effect.flip);
      assert.equal(limited.reason, "rate-limited");
      assert.include(limited.detail, "30 seconds");
    }).pipe(h.provide);
  });

  it.effect(
    "revokes the refresh token and forgets the connection, even when Trellis is unreachable",
    () => {
      const h = harness({
        respond: (request) =>
          request.url.endsWith("/oauth/revoke")
            ? Effect.succeed({ status: 500 })
            : Effect.succeed(isTokenCall(request) ? grant(1) : apiReply(request)),
      });
      return Effect.gen(function* () {
        const { trellis } = yield* connect;
        yield* trellis.disconnect;
        const revoke = h.requests.find((r) => r.url.endsWith("/oauth/revoke"))!;
        assert.equal(revoke.params.get("token"), "refresh-1");
        assert.equal(storedRefreshToken(h.stored), undefined);
        assert.deepEqual(yield* trellis.status, { state: "disconnected" });
      }).pipe(h.provide);
    },
  );
});
