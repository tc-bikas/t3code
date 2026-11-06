import type {
  TeamAuthConfig,
  TeamMe,
  TeamOrganizationDetail,
  TeamSession,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { writeLocalStorageValue } from "../hooks/useLocalStorage";
import { isTeamError, teamApi, TeamError } from "./teamClient";

export const TEAM_SERVER_URL_KEY = "t3code:team:server-url";
export const TEAM_ACTIVE_ORGANIZATION_KEY = "t3code:team:active-organization";
export const TEAM_TOKENS_KEY = "t3code:team:tokens";
export const TeamTokens = Schema.Record(Schema.String, Schema.String);
export const NO_TEAM_TOKENS: typeof TeamTokens.Type = {};

export function writeTeamToken(serverUrl: string, token: string | null) {
  writeLocalStorageValue(
    TEAM_TOKENS_KEY,
    (tokens) => {
      const { [serverUrl]: _dropped, ...rest } = tokens;
      return token === null ? rest : { ...rest, [serverUrl]: token };
    },
    NO_TEAM_TOKENS,
    TeamTokens,
  );
}

export type TeamSessionState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "unreachable" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly me: TeamMe };

export type TeamOrganizationState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: TeamError }
  | { readonly status: "ready"; readonly detail: TeamOrganizationDetail };

export type TeamSessionsState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly sessions: ReadonlyArray<TeamSession> };

export type TeamAuthConfigState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly config: TeamAuthConfig };

const LOADING = { status: "loading" } as const;
const SIGNED_OUT = { status: "signed-out" } as const;

const sessionKey = (serverUrl: string, token: string | null) => JSON.stringify([serverUrl, token]);
const organizationKey = (serverUrl: string, token: string | null, organizationId: string) =>
  JSON.stringify([serverUrl, token, organizationId]);

// Only the newest read of a key lands, so a slow answer cannot regress the state.
const latestRead = new Map<string, number>();
const nextRead = (key: string) => {
  const id = (latestRead.get(key) ?? 0) + 1;
  latestRead.set(key, id);
  return id;
};

const unauthorized = (serverUrl: string) => () => writeTeamToken(serverUrl, null);

/** Reading it starts a load; refreshing re-reads without dropping what is shown. */
const teamSessionAtom = Atom.family((key: string) =>
  Atom.writable(
    (get): TeamSessionState => {
      const [serverUrl, token] = JSON.parse(key) as [string, string | null];
      if (token === null) return SIGNED_OUT;
      void loadSession(get.registry, serverUrl, token);
      return LOADING;
    },
    (ctx, value: TeamSessionState) => ctx.setSelf(value),
  ).pipe(Atom.withLabel(`team:session:${key}`)),
);

export const teamSessionAtomFor = (serverUrl: string, token: string | null) =>
  teamSessionAtom(sessionKey(serverUrl, token));

export function refreshTeamSession(
  registry: AtomRegistry.AtomRegistry,
  serverUrl: string,
  token: string | null,
): Promise<void> {
  return token === null ? Promise.resolve() : loadSession(registry, serverUrl, token);
}

async function loadSession(
  registry: AtomRegistry.AtomRegistry,
  serverUrl: string,
  token: string,
): Promise<void> {
  const key = sessionKey(serverUrl, token);
  const read = nextRead(key);
  const atom = teamSessionAtom(key);
  const next = await teamApi(serverUrl, token, unauthorized(serverUrl))
    .me()
    .then(
      (me): TeamSessionState => ({ status: "ready", me }),
      (error: unknown): TeamSessionState =>
        isTeamError(error)
          ? error.code === "unreachable"
            ? { status: "unreachable" }
            : error.code === "unauthorized"
              ? SIGNED_OUT
              : { status: "failed", message: error.message }
          : { status: "failed", message: "Something went wrong." },
    );
  if (read === latestRead.get(key)) registry.set(atom, next);
}

const teamOrganizationAtom = Atom.family((key: string) =>
  Atom.writable(
    (get): TeamOrganizationState => {
      const [serverUrl, token, organizationId] = JSON.parse(key) as [string, string, string];
      void loadOrganization(get.registry, serverUrl, token, organizationId);
      return LOADING;
    },
    (ctx, value: TeamOrganizationState) => ctx.setSelf(value),
  ).pipe(Atom.withLabel(`team:organization:${key}`)),
);

export const teamOrganizationAtomFor = (serverUrl: string, token: string, organizationId: string) =>
  teamOrganizationAtom(organizationKey(serverUrl, token, organizationId));

export async function loadOrganization(
  registry: AtomRegistry.AtomRegistry,
  serverUrl: string,
  token: string,
  organizationId: string,
): Promise<void> {
  const key = organizationKey(serverUrl, token, organizationId);
  const read = nextRead(key);
  const atom = teamOrganizationAtom(key);
  const next = await teamApi(serverUrl, token, unauthorized(serverUrl))
    .organization(organizationId)
    .then(
      (detail): TeamOrganizationState => ({ status: "ready", detail }),
      (error: unknown): TeamOrganizationState => ({
        status: "failed",
        error: isTeamError(error)
          ? error
          : new TeamError({ code: "unavailable", serverUrl, status: 0 }),
      }),
    );
  if (read === latestRead.get(key)) registry.set(atom, next);
}

/** Mutations answer with the fresh detail, so it lands without another round trip. */
export function setTeamOrganizationDetail(
  registry: AtomRegistry.AtomRegistry,
  serverUrl: string,
  token: string,
  detail: TeamOrganizationDetail,
) {
  const key = organizationKey(serverUrl, token, detail.organization.id);
  nextRead(key);
  registry.set(teamOrganizationAtom(key), { status: "ready", detail });
}

const teamSessionsAtom = Atom.family((key: string) =>
  Atom.writable(
    (get): TeamSessionsState => {
      const [serverUrl, token] = JSON.parse(key) as [string, string];
      void loadTeamSessions(get.registry, serverUrl, token);
      return LOADING;
    },
    (ctx, value: TeamSessionsState) => ctx.setSelf(value),
  ).pipe(Atom.withLabel(`team:sessions:${key}`)),
);

const sessionsKey = (serverUrl: string, token: string) => JSON.stringify([serverUrl, token]);

export const teamSessionsAtomFor = (serverUrl: string, token: string) =>
  teamSessionsAtom(sessionsKey(serverUrl, token));

export async function loadTeamSessions(
  registry: AtomRegistry.AtomRegistry,
  serverUrl: string,
  token: string,
): Promise<void> {
  const key = sessionsKey(serverUrl, token);
  const read = nextRead(`sessions:${key}`);
  const next = await teamApi(serverUrl, token, unauthorized(serverUrl))
    .sessions()
    .then(
      ({ sessions }): TeamSessionsState => ({ status: "ready", sessions }),
      (error: unknown): TeamSessionsState => ({
        status: "failed",
        message: error instanceof Error ? error.message : "Something went wrong.",
      }),
    );
  if (read === latestRead.get(`sessions:${key}`)) registry.set(teamSessionsAtom(key), next);
}

const teamAuthConfigAtom = Atom.family((serverUrl: string) =>
  Atom.writable(
    (get): TeamAuthConfigState => {
      void loadTeamAuthConfig(get.registry, serverUrl);
      return LOADING;
    },
    (ctx, value: TeamAuthConfigState) => ctx.setSelf(value),
  ).pipe(Atom.withLabel(`team:auth-config:${serverUrl}`)),
);

export const teamAuthConfigAtomFor = (serverUrl: string) => teamAuthConfigAtom(serverUrl);

export async function loadTeamAuthConfig(
  registry: AtomRegistry.AtomRegistry,
  serverUrl: string,
): Promise<void> {
  const key = `auth-config:${serverUrl}`;
  const read = nextRead(key);
  const next = await teamApi(serverUrl, null, unauthorized(serverUrl))
    .authConfig()
    .then(
      (config): TeamAuthConfigState => ({ status: "ready", config }),
      (error: unknown): TeamAuthConfigState => ({
        status: "failed",
        message: error instanceof Error ? error.message : "Something went wrong.",
      }),
    );
  if (read === latestRead.get(key)) registry.set(teamAuthConfigAtom(serverUrl), next);
}
