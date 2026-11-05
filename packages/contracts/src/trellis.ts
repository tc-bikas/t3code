import * as Schema from "effect/Schema";

export const TrellisStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-configured"), message: Schema.String }),
  Schema.Struct({ state: Schema.Literal("disconnected") }),
  Schema.Struct({
    state: Schema.Literal("connected"),
    workspaceHandle: Schema.String,
    workspaceName: Schema.optional(Schema.String),
  }),
  Schema.Struct({ state: Schema.Literal("error"), message: Schema.String }),
]);
export type TrellisStatus = typeof TrellisStatus.Type;

/** The origin the browser uses for this server, which Trellis redirects back to. */
export const TrellisStartConnectInput = Schema.Struct({ origin: Schema.String });
export type TrellisStartConnectInput = typeof TrellisStartConnectInput.Type;

export const TrellisStartConnectResult = Schema.Struct({ authorizeUrl: Schema.String });
export type TrellisStartConnectResult = typeof TrellisStartConnectResult.Type;

const TRELLIS_ISSUE_SEARCH_MAX_QUERY_LENGTH = 200;
const TRELLIS_ISSUE_SEARCH_MAX_LIMIT = 50;

export const TrellisSearchIssuesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(TRELLIS_ISSUE_SEARCH_MAX_QUERY_LENGTH)),
  limit: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(TRELLIS_ISSUE_SEARCH_MAX_LIMIT),
    ),
  ),
});
export type TrellisSearchIssuesInput = typeof TrellisSearchIssuesInput.Type;

export const TrellisIssue = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  title: Schema.String,
  statusName: Schema.optional(Schema.String),
  projectName: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
export type TrellisIssue = typeof TrellisIssue.Type;

export const TrellisSearchIssuesResult = Schema.Struct({
  issues: Schema.Array(TrellisIssue),
});
export type TrellisSearchIssuesResult = typeof TrellisSearchIssuesResult.Type;

export const TrellisFailure = Schema.Literals([
  "not-configured",
  "not-connected",
  "unsupported-origin",
  "reconnect-required",
  "rate-limited",
  "denied",
  "invalid-state",
  "unavailable",
]);
export type TrellisFailure = typeof TrellisFailure.Type;

/** `detail` is written for the user; it never carries a credential or a raw Trellis payload. */
export class TrellisError extends Schema.TaggedError<TrellisError>()("TrellisError", {
  reason: TrellisFailure,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
