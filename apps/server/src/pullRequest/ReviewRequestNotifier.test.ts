import { expect, it } from "@effect/vitest";
import type { PullRequestReviewRequestNotice } from "@t3tools/contracts";
import type {
  SourceControlDriverInstance,
  SourceControlReviewRequestPoll,
} from "@t3tools/source-control-core/server/driver";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import * as PullRequestService from "./PullRequestService.ts";
import * as ReviewRequestNotifier from "./ReviewRequestNotifier.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const SECOND = 1_000;

const notice = (id: string, offsetMs: number): PullRequestReviewRequestNotice => ({
  id,
  host: "github.com",
  repository: "acme/web",
  number: 7,
  title: `Change ${id}`,
  url: "https://github.com/acme/web/pull/7",
  requestedAt: DateTime.formatIso(DateTime.makeUnsafe(NOW + offsetMs)),
});

function harness(answers: ReadonlyArray<SourceControlReviewRequestPoll>) {
  const inputs: Array<{ readonly host: string; readonly etag?: string | undefined }> = [];
  const invalidations: Array<unknown> = [];
  const script = [...answers];
  const pollReviewRequests: NonNullable<SourceControlDriverInstance["pollReviewRequests"]> = (
    input,
  ) =>
    Effect.sync(() => {
      inputs.push(input);
      return script.shift() ?? { _tag: "Unchanged", pollAfterMs: 60 * SECOND };
    });
  const layer = ReviewRequestNotifier.layer.pipe(
    // The notifier fixes its start time when built, which is before the test body runs.
    Layer.provide(Layer.effectDiscard(TestClock.setTime(NOW))),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(SourceControlBuiltInDrivers.SourceControlDrivers, [
          {
            driver: { kind: "github" },
            instance: { pollReviewRequests },
          },
        ] as unknown as SourceControlBuiltInDrivers.SourceControlDrivers["Service"]),
        Layer.mock(PullRequestService.PullRequestService)({
          invalidate: (_input, options) =>
            Effect.sync(() => {
              invalidations.push(options);
            }),
        }),
      ),
    ),
  );
  return { layer, inputs, invalidations };
}

it.effect("announces only new, unseen requests, once, and follows the poll interval", () => {
  const { layer, inputs, invalidations } = harness([
    // Waiting before the server started, so not news.
    {
      _tag: "Changed",
      etag: "e1",
      pollAfterMs: 60 * SECOND,
      notices: [notice("old", -SECOND)],
    },
    { _tag: "Changed", etag: "e2", pollAfterMs: 90 * SECOND, notices: [notice("a", SECOND)] },
    { _tag: "Unchanged", pollAfterMs: 60 * SECOND },
    // The same request again, as GitHub keeps listing unread items.
    {
      _tag: "Changed",
      etag: "e3",
      pollAfterMs: 60 * SECOND,
      notices: [notice("a", SECOND), notice("b", 2 * SECOND)],
    },
  ]);
  return Effect.gen(function* () {
    const service = yield* ReviewRequestNotifier.ReviewRequestNotifier;
    const received = yield* Queue.unbounded<PullRequestReviewRequestNotice>();
    const stream = yield* service.subscribe;
    yield* stream.pipe(
      Stream.runForEach((item) => Queue.offer(received, item)),
      Effect.forkScoped,
    );

    yield* TestClock.adjust(0);
    expect(inputs).toEqual([{ host: "github.com", etag: undefined }]);
    yield* TestClock.adjust(59 * SECOND);
    expect(inputs).toHaveLength(1);
    yield* TestClock.adjust(1 * SECOND);
    expect(inputs.at(-1)).toEqual({ host: "github.com", etag: "e1" });
    expect((yield* Queue.take(received)).id).toBe("a");

    // GitHub asked for 90 seconds.
    yield* TestClock.adjust(89 * SECOND);
    expect(inputs).toHaveLength(2);
    yield* TestClock.adjust(1 * SECOND);
    // A 304 keeps the ETag.
    expect(inputs.at(-1)).toEqual({ host: "github.com", etag: "e2" });
    yield* TestClock.adjust(60 * SECOND);
    expect(inputs.at(-1)).toEqual({ host: "github.com", etag: "e2" });
    expect((yield* Queue.take(received)).id).toBe("b");
    expect(yield* Queue.size(received)).toBe(0);
    expect(invalidations).toEqual([{ notifyReaders: true }, { notifyReaders: true }]);
  }).pipe(Effect.provide(layer));
});

it.effect("waits out an unavailable answer", () => {
  const { layer, inputs } = harness([{ _tag: "Unavailable", retryAfterMs: 15 * 60 * SECOND }]);
  return Effect.gen(function* () {
    yield* ReviewRequestNotifier.ReviewRequestNotifier;
    yield* TestClock.adjust(14 * 60 * SECOND);
    expect(inputs).toHaveLength(1);
    yield* TestClock.adjust(60 * SECOND);
    expect(inputs).toHaveLength(2);
  }).pipe(Effect.provide(layer));
});
