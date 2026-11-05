import {
  TrellisError,
  type TrellisFailure,
  type TrellisIssue,
  type TrellisSearchIssuesInput,
  type TrellisSearchIssuesResult,
  type TrellisStartConnectInput,
  type TrellisStartConnectResult,
  type TrellisStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { timingSafeEqualBase64Url } from "../auth/utils.ts";

/** Trellis registers this exact path for loopback redirects and ignores the port. */
export const TRELLIS_CALLBACK_PATH = "/oauth/trellis/callback";

const DEFAULT_BASE_URL = "https://beta.trellisapp.co.uk";
const SECRET_NAME = "trellis-connection";
const SCOPES = "workspace:read projects:read issues:read";
const FLOW_TTL_MS = Duration.toMillis(Duration.minutes(10));
const MAX_PENDING_FLOWS = 8;
const REFRESH_EARLY_MS = Duration.toMillis(Duration.minutes(1));
// A stalled request holds the refresh lock, so it must end.
const REQUEST_TIMEOUT = Duration.seconds(15);
const DEFAULT_SEARCH_LIMIT = 20;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

const fail = (reason: TrellisFailure, detail: string) =>
  Effect.fail(new TrellisError({ reason, detail }));

const unavailable = new TrellisError({
  reason: "unavailable",
  detail: "Couldn't reach Trellis. Try again in a moment.",
});
const reconnectRequired = new TrellisError({
  reason: "reconnect-required",
  detail: "Trellis no longer accepts this connection. Connect Trellis again.",
});
const notConnected = new TrellisError({
  reason: "not-connected",
  detail: "Trellis isn't connected. Connect Trellis first.",
});
const invalidFlow = new TrellisError({
  reason: "invalid-state",
  detail: "This Trellis connection attempt expired or was already used. Start again from T3 Code.",
});
const storeFailed = new TrellisError({
  reason: "unavailable",
  detail: "Couldn't save the Trellis connection on this computer.",
});

/** Trellis only accepts a loopback redirect on the same hostname the browser is using. */
export function trellisRedirectUri(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname)) return undefined;
    return `${url.origin}${TRELLIS_CALLBACK_PATH}`;
  } catch {
    return undefined;
  }
}

function trellisBaseOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
    return url.protocol === "https:" || loopbackHttp ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const readVariable = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Effect.map((value) => Option.filter(value, (text) => text.trim().length > 0)),
    Effect.map((value) => Option.map(value, (text) => text.trim())),
    Effect.orElseSucceed(Option.none<string>),
  );

const resolveConfig = Effect.gen(function* () {
  const baseUrl = Option.getOrElse(
    yield* readVariable("T3CODE_TRELLIS_BASE_URL"),
    () => DEFAULT_BASE_URL,
  );
  const clientId = yield* readVariable("T3CODE_TRELLIS_CLIENT_ID");
  const clientSecret = yield* readVariable("T3CODE_TRELLIS_CLIENT_SECRET");
  const workspace = yield* readVariable("T3CODE_TRELLIS_WORKSPACE");
  const missing = [
    ...(Option.isNone(clientId) ? ["T3CODE_TRELLIS_CLIENT_ID"] : []),
    ...(Option.isNone(clientSecret) ? ["T3CODE_TRELLIS_CLIENT_SECRET"] : []),
    ...(Option.isNone(workspace) ? ["T3CODE_TRELLIS_WORKSPACE"] : []),
  ];
  if (!Option.isSome(clientId) || !Option.isSome(clientSecret) || !Option.isSome(workspace)) {
    return yield* fail(
      "not-configured",
      `Set ${missing.join(", ")} in the server's environment to connect Trellis.`,
    );
  }
  const origin = trellisBaseOrigin(baseUrl);
  if (origin === undefined) {
    return yield* fail(
      "not-configured",
      "T3CODE_TRELLIS_BASE_URL must be an https URL, such as https://trellisapp.co.uk.",
    );
  }
  return {
    baseUrl: origin,
    clientId: clientId.value,
    clientSecret: Redacted.make(clientSecret.value),
    workspace: workspace.value,
  };
});
type TrellisConfig = Effect.Success<typeof resolveConfig>;

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
});
const decodeTokenResponse = Schema.decodeUnknownOption(TokenResponse);

const ErrorBody = Schema.Struct({ error: Schema.optional(Schema.String) });
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

const IssueSearchBody = Schema.NullOr(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      code: Schema.String,
      title: Schema.String,
      status_name: Schema.optional(Schema.NullOr(Schema.String)),
      project_key: Schema.optional(Schema.NullOr(Schema.String)),
      project_name: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);
const decodeIssueSearch = Schema.decodeUnknownOption(IssueSearchBody);

const AppIdentityBody = Schema.Struct({ workspace_name: Schema.optional(Schema.String) });
const decodeAppIdentity = Schema.decodeUnknownOption(AppIdentityBody);

const PersistedConnection = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), refreshToken: Schema.String }),
);
const decodePersisted = Schema.decodeUnknownOption(PersistedConnection);
const encodePersisted = Schema.encodeSync(PersistedConnection);

interface PendingFlow {
  readonly state: string;
  readonly verifier: Redacted.Redacted;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

interface Session {
  readonly accessToken: Redacted.Redacted;
  readonly refreshToken: Redacted.Redacted;
  readonly expiresAt: number;
}

interface HttpAnswer {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;
  readonly body: unknown;
}

const rateLimited = (retryAfterSeconds: number | undefined) =>
  new TrellisError({
    reason: "rate-limited",
    detail:
      retryAfterSeconds === undefined
        ? "Trellis is limiting requests. Try again in a moment."
        : `Trellis is limiting requests. Try again in ${retryAfterSeconds} seconds.`,
  });

const issueUrl = (
  config: TrellisConfig,
  issue: { readonly code: string; readonly project_key?: string | null | undefined },
) =>
  issue.project_key
    ? `${config.baseUrl}/${encodeURIComponent(config.workspace)}/projects/${encodeURIComponent(issue.project_key)}/tasks?code=${encodeURIComponent(issue.code)}`
    : undefined;

export class TrellisService extends Context.Service<
  TrellisService,
  {
    readonly status: Effect.Effect<TrellisStatus>;
    readonly startConnect: (
      input: TrellisStartConnectInput,
    ) => Effect.Effect<TrellisStartConnectResult, TrellisError>;
    /** Called by the browser callback with whatever Trellis put in the redirect. */
    readonly completeConnect: (input: {
      readonly state: string;
      readonly code?: string | undefined;
      readonly error?: string | undefined;
    }) => Effect.Effect<void, TrellisError>;
    readonly searchIssues: (
      input: TrellisSearchIssuesInput,
    ) => Effect.Effect<TrellisSearchIssuesResult, TrellisError>;
    readonly disconnect: Effect.Effect<void, TrellisError>;
  }
>()("t3/trellis/TrellisService") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;

  const pending = yield* Ref.make<ReadonlyArray<PendingFlow>>([]);
  const session = yield* Ref.make<Option.Option<Session>>(Option.none());
  // Cached once Trellis has answered for this connection, so reopening the dialog costs no request.
  const verified = yield* Ref.make<Option.Option<{ readonly workspaceName: string | undefined }>>(
    Option.none(),
  );
  // Refresh tokens rotate: two refreshes in flight would revoke the whole chain.
  const lock = yield* Semaphore.make(1);

  const send = (request: HttpClientRequest.HttpClientRequest) =>
    httpClient.execute(request).pipe(
      // Query strings carry what the user typed into search.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.flatMap((response) =>
        response.json.pipe(
          Effect.orElseSucceed((): unknown => undefined),
          Effect.map((body): HttpAnswer => ({
            status: response.status,
            retryAfterSeconds: parseRetryAfter(response.headers["retry-after"]),
            body,
          })),
        ),
      ),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(() => unavailable),
    );

  const tokenRequest = (config: TrellisConfig, params: Record<string, string>) =>
    send(
      HttpClientRequest.post(`${config.baseUrl}/oauth/token`).pipe(
        HttpClientRequest.basicAuth(config.clientId, config.clientSecret),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams(params),
      ),
    );

  const oauthErrorCode = (answer: HttpAnswer) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeErrorBody(answer.body), (b) => b.error));

  const readTokens = Effect.fn("TrellisService.readTokens")(function* (answer: HttpAnswer) {
    const tokens = decodeTokenResponse(answer.body);
    if (Option.isNone(tokens)) return yield* unavailable;
    const now = yield* Clock.currentTimeMillis;
    return {
      accessToken: Redacted.make(tokens.value.access_token),
      refreshToken: Redacted.make(tokens.value.refresh_token),
      expiresAt: now + tokens.value.expires_in * 1000,
    } satisfies Session;
  });

  const persist = (refreshToken: Redacted.Redacted) =>
    secrets
      .set(
        SECRET_NAME,
        new TextEncoder().encode(
          encodePersisted({ version: 1, refreshToken: Redacted.value(refreshToken) }),
        ),
      )
      .pipe(Effect.mapError(() => storeFailed));

  const readPersistedRefreshToken = secrets.get(SECRET_NAME).pipe(
    Effect.mapError(() => storeFailed),
    Effect.map((stored) =>
      Option.flatMap(stored, (bytes) =>
        Option.map(decodePersisted(new TextDecoder().decode(bytes)), (value) =>
          Redacted.make(value.refreshToken),
        ),
      ),
    ),
  );

  const forgetConnection = Effect.gen(function* () {
    yield* Ref.set(session, Option.none());
    yield* Ref.set(verified, Option.none());
    yield* secrets.remove(SECRET_NAME).pipe(Effect.mapError(() => storeFailed));
  });

  const refresh = Effect.fn("TrellisService.refresh")(function* (
    config: TrellisConfig,
    refreshToken: Redacted.Redacted,
  ) {
    const answer = yield* tokenRequest(config, {
      grant_type: "refresh_token",
      refresh_token: Redacted.value(refreshToken),
    });
    if (answer.status === 429) return yield* rateLimited(answer.retryAfterSeconds);
    if (answer.status >= 200 && answer.status < 300) {
      const next = yield* readTokens(answer);
      yield* Ref.set(session, Option.some(next));
      // The old refresh token is already revoked, so a failed save keeps the new pair in memory.
      yield* persist(next.refreshToken).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Trellis refresh token could not be saved", { reason: error.reason }),
        ),
      );
      return next;
    }
    const code = oauthErrorCode(answer);
    if (
      answer.status === 400 ||
      answer.status === 401 ||
      code === "invalid_grant" ||
      code === "unauthorized_client" ||
      code === "invalid_client"
    ) {
      yield* forgetConnection;
      return yield* reconnectRequired;
    }
    return yield* unavailable;
  });

  const accessToken = Effect.fn("TrellisService.accessToken")(function* (config: TrellisConfig) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const current = yield* Ref.get(session);
        if (Option.isSome(current) && current.value.expiresAt - now > REFRESH_EARLY_MS) {
          return current.value.accessToken;
        }
        const refreshToken = Option.isSome(current)
          ? Option.some(current.value.refreshToken)
          : yield* readPersistedRefreshToken;
        if (Option.isNone(refreshToken)) return yield* notConnected;
        return (yield* refresh(config, refreshToken.value)).accessToken;
      }),
    );
  });

  const apiGet = Effect.fn("TrellisService.apiGet")(function* (
    config: TrellisConfig,
    path: string,
    params: Record<string, string>,
  ) {
    const attempt = Effect.gen(function* () {
      const token = yield* accessToken(config);
      return yield* send(
        HttpClientRequest.get(
          `${config.baseUrl}/api/v1/workspace/${encodeURIComponent(config.workspace)}${path}`,
        ).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.acceptJson,
          HttpClientRequest.setUrlParams(params),
        ),
      );
    });
    let answer = yield* attempt;
    if (answer.status === 401) {
      // The token may have been revoked or expired early; one refresh settles which.
      yield* Ref.set(session, Option.none());
      answer = yield* attempt;
    }
    switch (true) {
      case answer.status >= 200 && answer.status < 300:
        return answer.body;
      case answer.status === 401:
        return yield* reconnectRequired;
      case answer.status === 403:
        return yield* fail(
          "denied",
          "Trellis denied access. Check the Trellis application's access to this workspace.",
        );
      case answer.status === 404:
        return yield* fail(
          "denied",
          "Trellis couldn't find that workspace. Check T3CODE_TRELLIS_WORKSPACE.",
        );
      case answer.status === 429:
        return yield* rateLimited(answer.retryAfterSeconds);
      default:
        return yield* unavailable;
    }
  });

  const hasConnection = Effect.gen(function* () {
    if (Option.isSome(yield* Ref.get(session))) return true;
    return Option.isSome(yield* readPersistedRefreshToken);
  });

  const readStatus = Effect.fn("TrellisService.readStatus")(function* (): Effect.fn.Return<
    TrellisStatus,
    TrellisError
  > {
    const config = yield* resolveConfig;
    if (!(yield* hasConnection)) return { state: "disconnected" };
    const known = yield* Ref.get(verified);
    const identity = Option.isSome(known)
      ? known.value
      : yield* apiGet(config, "/app", {}).pipe(
          Effect.map((body) => ({
            workspaceName: Option.getOrUndefined(
              Option.flatMapNullishOr(decodeAppIdentity(body), (value) => value.workspace_name),
            ),
          })),
          Effect.tap((value) => Ref.set(verified, Option.some(value))),
        );
    return {
      state: "connected",
      workspaceHandle: config.workspace,
      ...(identity.workspaceName === undefined ? {} : { workspaceName: identity.workspaceName }),
    };
  });

  const statusOfFailure = Effect.fn("TrellisService.statusOfFailure")(function* (
    error: TrellisError,
  ): Effect.fn.Return<TrellisStatus> {
    if (error.reason === "not-configured") {
      return { state: "not-configured", message: error.detail };
    }
    // A rejected refresh token removes the connection, which is then simply not connected.
    const connected = yield* hasConnection.pipe(Effect.orElseSucceed(() => true));
    return connected || error.reason !== "reconnect-required"
      ? { state: "error", message: error.detail }
      : { state: "disconnected" };
  });

  const status: TrellisService["Service"]["status"] = readStatus().pipe(
    Effect.catch(statusOfFailure),
  );

  const startConnect = Effect.fn("TrellisService.startConnect")(function* (
    input: TrellisStartConnectInput,
  ) {
    const config = yield* resolveConfig;
    const redirectUri = trellisRedirectUri(input.origin);
    if (redirectUri === undefined) {
      return yield* fail(
        "unsupported-origin",
        "Connect Trellis only works when T3 Code is opened on the same computer as its server.",
      );
    }
    const verifier = Base64Url.encode(yield* random.randomBytes(32).pipe(Effect.orDie));
    const challenge = Base64Url.encode(
      yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier)).pipe(Effect.orDie),
    );
    const state = Base64Url.encode(yield* random.randomBytes(32).pipe(Effect.orDie));
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(pending, (flows) =>
      [
        ...flows.filter((flow) => flow.expiresAt > now),
        { state, verifier: Redacted.make(verifier), redirectUri, expiresAt: now + FLOW_TTL_MS },
      ].slice(-MAX_PENDING_FLOWS),
    );
    const authorize = new URL(`${config.baseUrl}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return { authorizeUrl: authorize.toString() };
  });

  const takeFlow = Effect.fn("TrellisService.takeFlow")(function* (state: string) {
    const now = yield* Clock.currentTimeMillis;
    const flows = yield* Ref.get(pending);
    // Compare against every flow so the lookup time does not depend on where the state matches.
    let matched: PendingFlow | undefined;
    for (const flow of flows) {
      if (timingSafeEqualBase64Url(flow.state, state)) matched = flow;
    }
    yield* Ref.set(
      pending,
      flows.filter((flow) => flow !== matched && flow.expiresAt > now),
    );
    return matched !== undefined && matched.expiresAt > now ? matched : undefined;
  });

  const completeConnect = Effect.fn("TrellisService.completeConnect")(function* (input: {
    readonly state: string;
    readonly code?: string | undefined;
    readonly error?: string | undefined;
  }) {
    const flow = yield* takeFlow(input.state);
    if (flow === undefined) return yield* invalidFlow;
    if (input.error !== undefined) {
      return yield* fail(
        "denied",
        input.error === "access_denied"
          ? "Trellis access wasn't approved."
          : "Trellis couldn't complete the connection.",
      );
    }
    if (input.code === undefined || input.code.length === 0) return yield* invalidFlow;
    const config = yield* resolveConfig;
    const answer = yield* tokenRequest(config, {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: flow.redirectUri,
      code_verifier: Redacted.value(flow.verifier),
    });
    if (answer.status === 429) return yield* rateLimited(answer.retryAfterSeconds);
    if (answer.status < 200 || answer.status >= 300) {
      const code = oauthErrorCode(answer);
      if (code === "invalid_grant") return yield* invalidFlow;
      if (code === "unauthorized_client" || code === "invalid_client") {
        return yield* fail(
          "denied",
          "Trellis doesn't recognise this T3 Code application. Check T3CODE_TRELLIS_CLIENT_ID and T3CODE_TRELLIS_CLIENT_SECRET.",
        );
      }
      return yield* unavailable;
    }
    const tokens = yield* readTokens(answer);
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* persist(tokens.refreshToken);
        yield* Ref.set(session, Option.some(tokens));
        yield* Ref.set(verified, Option.none());
      }),
    );
  });

  const searchIssues = Effect.fn("TrellisService.searchIssues")(function* (
    input: TrellisSearchIssuesInput,
  ) {
    const config = yield* resolveConfig;
    const query = input.query.trim();
    const body = yield* apiGet(config, "/issues/search", {
      ...(query.length === 0 ? {} : { q: query }),
      limit: String(input.limit ?? DEFAULT_SEARCH_LIMIT),
    });
    const decoded = decodeIssueSearch(body);
    if (Option.isNone(decoded)) return yield* unavailable;
    return {
      issues: (decoded.value ?? []).map((issue): TrellisIssue => {
        const url = issueUrl(config, issue);
        return {
          id: issue.id,
          code: issue.code,
          title: issue.title,
          ...(issue.status_name ? { statusName: issue.status_name } : {}),
          ...(issue.project_name ? { projectName: issue.project_name } : {}),
          ...(url === undefined ? {} : { url }),
        };
      }),
    };
  });

  const disconnect = Effect.gen(function* () {
    const config = yield* Effect.option(resolveConfig);
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(session);
        const refreshToken = Option.isSome(current)
          ? Option.some(current.value.refreshToken)
          : yield* readPersistedRefreshToken.pipe(Effect.orElseSucceed(Option.none));
        if (Option.isSome(config) && Option.isSome(refreshToken)) {
          // Best effort: the local connection is removed even when Trellis can't be reached.
          yield* send(
            HttpClientRequest.post(`${config.value.baseUrl}/oauth/revoke`).pipe(
              HttpClientRequest.basicAuth(config.value.clientId, config.value.clientSecret),
              HttpClientRequest.bodyUrlParams({ token: Redacted.value(refreshToken.value) }),
            ),
          ).pipe(Effect.ignore);
        }
        yield* forgetConnection;
      }),
    );
  }).pipe(Effect.withSpan("TrellisService.disconnect"));

  return TrellisService.of({ status, startConnect, completeConnect, searchIssues, disconnect });
});

function parseRetryAfter(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

export const layer = Layer.effect(TrellisService, make);
