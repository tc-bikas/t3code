import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { renderTrellisCallbackPage } from "./callbackHtml.ts";
import * as TrellisService from "./TrellisService.ts";

const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const page = (result: Parameters<typeof renderTrellisCallbackPage>[0]) =>
  HttpServerResponse.text(renderTrellisCallbackPage(result), {
    status: result.connected ? 200 : 400,
    contentType: "text/html; charset=utf-8",
    headers: PAGE_HEADERS,
  });

/** Trellis redirects the user's browser here; it carries no T3 session, so `state` is the only proof. */
export const layer = HttpRouter.add(
  "GET",
  TrellisService.TRELLIS_CALLBACK_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = new URL(request.url, "http://localhost").searchParams;
    const state = params.get("state");
    if (state === null || state.length === 0 || state.length > 256) {
      return page({
        connected: false,
        reason: "This page was opened without a Trellis connection attempt.",
      });
    }
    const trellis = yield* TrellisService.TrellisService;
    return yield* trellis
      .completeConnect({
        state,
        code: params.get("code") ?? undefined,
        error: params.get("error") ?? undefined,
      })
      .pipe(
        Effect.as(page({ connected: true })),
        Effect.catchTags({
          TrellisError: (error) => Effect.succeed(page({ connected: false, reason: error.detail })),
        }),
      );
  }),
);
