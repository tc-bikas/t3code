import type { PullRequestReviewRequestNotice } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import { forkParked } from "../serverActivation.ts";
import * as PullRequestService from "./PullRequestService.ts";

/**
 * Only GitHub has a notification inbox this reads; other providers are not supported here.
 * A GitHub Enterprise host would need its own account to poll, so github.com is the one host.
 */
const HOST = "github.com";
const SEEN_LIMIT = 500;

export class ReviewRequestNotifier extends Context.Service<
  ReviewRequestNotifier,
  {
    /** New review requests from the moment this resolves; never history. */
    readonly subscribe: Effect.Effect<
      Stream.Stream<PullRequestReviewRequestNotice>,
      never,
      Scope.Scope
    >;
  }
>()("t3/pullRequest/ReviewRequestNotifier") {}

const make = Effect.gen(function* () {
  const drivers = yield* SourceControlBuiltInDrivers.SourceControlDrivers;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const poll = drivers.find(({ driver }) => driver.kind === "github")?.instance.pollReviewRequests;
  const notices = yield* PubSub.sliding<PullRequestReviewRequestNotice>(64);

  if (poll !== undefined) {
    // Requests older than this server run were already waiting; only later ones are news.
    const startedAt = yield* Clock.currentTimeMillis;
    const seen = new Set<string>();
    let etag: string | undefined;

    const once = Effect.gen(function* () {
      const answer = yield* poll({ host: HOST, etag });
      if (answer._tag === "Unavailable") return answer.retryAfterMs;
      if (answer._tag === "Unchanged") return answer.pollAfterMs;
      etag = answer.etag;
      const fresh = answer.notices.filter(
        (notice) => Date.parse(notice.requestedAt) > startedAt && !seen.has(notice.id),
      );
      for (const notice of fresh) {
        seen.add(notice.id);
        if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);
        yield* PubSub.publish(notices, notice);
      }
      // Lists were cached before the request; readers refetch on this signal.
      if (fresh.length > 0) yield* pullRequests.invalidate({}, { notifyReaders: true });
      return answer.pollAfterMs;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("review request poll failed", { cause }).pipe(Effect.as(5 * 60_000)),
      ),
    );

    yield* forkParked(
      Effect.forever(
        once.pipe(Effect.flatMap((delayMs) => Effect.sleep(Duration.millis(delayMs)))),
      ),
    );
  }

  return ReviewRequestNotifier.of({
    subscribe: PubSub.subscribe(notices).pipe(Effect.map(Stream.fromSubscription)),
  });
});

export const layer = Layer.effect(ReviewRequestNotifier, make);
