import type { PullRequestReviewRequestNotice } from "@t3tools/contracts";
import type { SourceControlReviewRequestPoll } from "@t3tools/source-control-core/server/driver";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

/** GitHub asks clients to honor X-Poll-Interval, which is 60 seconds today. */
const MIN_POLL_MS = 60_000;
/** Signed out, refused, or offline: checking again sooner only spends credential lookups. */
const UNAVAILABLE_RETRY_MS = 5 * 60_000;

const decodeNotifications = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        reason: Schema.String,
        updated_at: Schema.String,
        subject: Schema.Struct({
          title: Schema.String,
          url: Schema.NullOr(Schema.String),
          type: Schema.String,
        }),
        repository: Schema.Struct({ full_name: Schema.String }),
      }),
    ),
  ),
);

const PULL_REQUEST_NUMBER = /\/pulls\/(\d+)$/u;

/** Notices for the pull requests whose review was requested, oldest first. */
function reviewRequestNotices(
  host: string,
  body: string,
): ReadonlyArray<PullRequestReviewRequestNotice> {
  const notices: Array<PullRequestReviewRequestNotice> = [];
  for (const item of Option.getOrElse(decodeNotifications(body), () => [])) {
    if (item.reason !== "review_requested" || item.subject.type !== "PullRequest") continue;
    const number = Number(PULL_REQUEST_NUMBER.exec(item.subject.url ?? "")?.[1]);
    const requestedAt = Date.parse(item.updated_at);
    if (!Number.isSafeInteger(number) || number < 1 || Number.isNaN(requestedAt)) continue;
    notices.push({
      id: `${item.id}:${item.updated_at}`,
      host,
      repository: item.repository.full_name,
      number,
      title: item.subject.title,
      url: `https://${host}/${item.repository.full_name}/pull/${number}`,
      requestedAt: item.updated_at,
    });
  }
  return notices.toSorted((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
}

const pollAfterMs = (headers: GitHubRest.GitHubRestResponse["headers"]) => {
  const seconds = Number(headers["x-poll-interval"]);
  return Math.max(MIN_POLL_MS, Number.isFinite(seconds) ? seconds * 1_000 : 0);
};

const unavailable = (
  error: GitHubRequestPolicy.GitHubApiError,
  now: number,
): SourceControlReviewRequestPoll => {
  const retryAt =
    error._tag === "GitHubApiRateLimitError" || error._tag === "SourceControlRateLimitPausedError"
      ? error.retryAt
      : undefined;
  return {
    _tag: "Unavailable",
    retryAfterMs:
      retryAt === undefined ? UNAVAILABLE_RETRY_MS : Math.max(UNAVAILABLE_RETRY_MS, retryAt - now),
  };
};

/**
 * Reads unread notifications the account takes part in. Background class (never Interactive),
 * and a 304 for a known ETag does not spend quota.
 */
export const makePollReviewRequests = Effect.gen(function* () {
  const api = yield* GitHubRest.GitHubRest;
  return Effect.fn("GitHubDriver.pollReviewRequests")(function* (input: {
    readonly host: string;
    readonly etag?: string | undefined;
  }) {
    return yield* api
      .rest({
        host: input.host,
        operation: "pollReviewRequests",
        path: "notifications?participating=true&per_page=50",
        ...(input.etag === undefined ? {} : { ifNoneMatch: input.etag }),
        allowReserve: false,
      })
      .pipe(
        Effect.map((response): SourceControlReviewRequestPoll => {
          const delay = pollAfterMs(response.headers);
          return response.status === 304
            ? { _tag: "Unchanged", pollAfterMs: delay }
            : {
                _tag: "Changed",
                etag: response.headers.etag,
                pollAfterMs: delay,
                notices: reviewRequestNotices(input.host, response.body),
              };
        }),
        Effect.catch((error) =>
          Clock.currentTimeMillis.pipe(Effect.map((now) => unavailable(error, now))),
        ),
      );
  });
});
