import { describe, expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";

import * as GitHubAppSignIn from "./GitHubAppSignIn.ts";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubQuota from "./GitHubQuota.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubReviewRequests from "./GitHubReviewRequests.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

const notification = (input: {
  readonly id: string;
  readonly reason: string;
  readonly type?: string;
  readonly number?: number;
  readonly updatedAt?: string;
}) => ({
  id: input.id,
  reason: input.reason,
  updated_at: input.updatedAt ?? "2026-10-05T11:59:30Z",
  subject: {
    title: `Change ${input.id}`,
    url: `https://api.github.com/repos/acme/web/pulls/${input.number ?? 7}`,
    type: input.type ?? "PullRequest",
  },
  repository: { full_name: "acme/web" },
});

function harness(respond: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const credentials = Layer.succeed(
    GitHubCredentials.GitHubCredentials,
    GitHubCredentials.GitHubCredentials.of({
      get: (host) =>
        Effect.succeed({
          host,
          token: Redacted.make("token"),
          source: "gh" as const,
          fingerprint: `${host}:token`,
        }),
      saved: () => Effect.succeedNone,
      fingerprint: (host, token) => Effect.succeed(`${host}:${token}`),
      invalidate: () => Effect.void,
    }),
  );
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request);
      return Effect.succeed(HttpClientResponse.fromWeb(request, respond(request)));
    }),
  );
  const appSignedOut = Layer.mock(GitHubAppSignIn.GitHubAppSignIn)({
    enabled: false,
    token: () => Effect.succeedNone,
    invalidate: () => Effect.void,
  });
  const layer = GitHubRest.layer.pipe(
    Layer.provide(Layer.mergeAll(credentials, http, appSignedOut)),
    Layer.provideMerge(GitHubQuota.layer),
    Layer.provideMerge(SourceControlRateLimit.layer),
    Layer.provideMerge(NodeCrypto.layer),
  );
  return { layer, requests };
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

describe("GitHubReviewRequests", () => {
  it.effect("keeps only review requests on pull requests", () => {
    const { layer } = harness(() =>
      json(
        [
          notification({ id: "1", reason: "review_requested", number: 7 }),
          notification({ id: "2", reason: "mention" }),
          notification({ id: "3", reason: "review_requested", type: "Issue" }),
          notification({
            id: "4",
            reason: "review_requested",
            number: 9,
            updatedAt: "2026-10-05T11:50:00Z",
          }),
        ],
        { headers: { etag: 'W/"abc"', "x-poll-interval": "60" } },
      ),
    );
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const poll = yield* GitHubReviewRequests.makePollReviewRequests;
      const answer = yield* poll({ host: "github.com" });
      expect(answer).toEqual({
        _tag: "Changed",
        etag: 'W/"abc"',
        pollAfterMs: 60_000,
        notices: [
          {
            id: "4:2026-10-05T11:50:00Z",
            host: "github.com",
            repository: "acme/web",
            number: 9,
            title: "Change 4",
            url: "https://github.com/acme/web/pull/9",
            requestedAt: "2026-10-05T11:50:00Z",
          },
          {
            id: "1:2026-10-05T11:59:30Z",
            host: "github.com",
            repository: "acme/web",
            number: 7,
            title: "Change 1",
            url: "https://github.com/acme/web/pull/7",
            requestedAt: "2026-10-05T11:59:30Z",
          },
        ],
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "sends the ETag back, reads 304 as unchanged, and never polls faster than GitHub asks",
    () => {
      const { layer, requests } = harness((request) =>
        request.headers["if-none-match"] === undefined
          ? json([], { headers: { etag: '"e1"', "x-poll-interval": "60" } })
          : new Response(null, { status: 304, headers: { "x-poll-interval": "180" } }),
      );
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const poll = yield* GitHubReviewRequests.makePollReviewRequests;
        const first = yield* poll({ host: "github.com" });
        expect(first).toMatchObject({ _tag: "Changed", etag: '"e1"' });
        const second = yield* poll({ host: "github.com", etag: '"e1"' });
        expect(second).toEqual({ _tag: "Unchanged", pollAfterMs: 180_000 });
        expect(requests.map((request) => request.headers["if-none-match"])).toEqual([
          undefined,
          '"e1"',
        ]);
        expect(requests[0]?.url).toContain("/notifications?participating=true");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("backs off quietly when rate limited or signed out", () => {
    const { layer } = harness(() =>
      json({ message: "rate limit" }, { status: 429, headers: { "retry-after": "900" } }),
    );
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const poll = yield* GitHubReviewRequests.makePollReviewRequests;
      const answer = yield* poll({ host: "github.com" });
      expect(answer).toEqual({ _tag: "Unavailable", retryAfterMs: 900_000 });
      // The host is paused now, so the next poll fails locally without a request.
      const paused = yield* poll({ host: "github.com" });
      expect(paused._tag).toBe("Unavailable");
    }).pipe(Effect.provide(layer));
  });
});
