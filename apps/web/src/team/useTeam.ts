import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { TeamMembership, TeamOrganizationDetail } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useContext, useEffect, useRef, useState } from "react";

import { isElectron } from "../env";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { ensureLocalApi } from "../localApi";
import {
  DEFAULT_TEAM_SERVER_URL,
  resolveActiveOrganizationId,
  teamDeviceLabel,
} from "./team.logic";
import { isTeamError, teamApi } from "./teamClient";
import {
  NO_TEAM_TOKENS,
  TEAM_ACTIVE_ORGANIZATION_KEY,
  TEAM_SERVER_URL_KEY,
  TEAM_TOKENS_KEY,
  TeamTokens,
  loadOrganization,
  loadTeamAuthConfig,
  loadTeamSessions,
  refreshTeamSession,
  setTeamOrganizationDetail,
  teamAuthConfigAtomFor,
  teamOrganizationAtomFor,
  teamSessionAtomFor,
  teamSessionsAtomFor,
  writeTeamToken,
} from "./teamStore";

export function useTeamAccount() {
  const registry = useContext(RegistryContext);
  const [serverUrl, setServerUrl] = useLocalStorage(
    TEAM_SERVER_URL_KEY,
    DEFAULT_TEAM_SERVER_URL,
    Schema.String,
  );
  const [tokens] = useLocalStorage(TEAM_TOKENS_KEY, NO_TEAM_TOKENS, TeamTokens);
  const token = tokens[serverUrl] ?? null;
  const session = useAtomValue(teamSessionAtomFor(serverUrl, token));
  const api = teamApi(serverUrl, token, () => writeTeamToken(serverUrl, null));

  return {
    serverUrl,
    setServerUrl,
    token,
    session,
    api,
    deviceLabel: teamDeviceLabel(navigator.userAgent, isElectron),
    refreshSession: () => refreshTeamSession(registry, serverUrl, token),
    storeToken: (next: string | null) => writeTeamToken(serverUrl, next),
  };
}

/** The organisation the person last chose, falling back to their first. */
export function useActiveTeamMembership(memberships: ReadonlyArray<TeamMembership>) {
  const [storedId, setStoredId] = useLocalStorage(TEAM_ACTIVE_ORGANIZATION_KEY, "", Schema.String);
  const activeId = resolveActiveOrganizationId(
    memberships.map((membership) => membership.organization.id),
    storedId,
  );
  return {
    active: memberships.find((membership) => membership.organization.id === activeId) ?? null,
    select: setStoredId,
  };
}

export function usePublishTeamOrganization(serverUrl: string, token: string) {
  const registry = useContext(RegistryContext);
  return (detail: TeamOrganizationDetail) =>
    setTeamOrganizationDetail(registry, serverUrl, token, detail);
}

export function useTeamOrganization(organizationId: string, serverUrl: string, token: string) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(teamOrganizationAtomFor(serverUrl, token, organizationId));
  const publish = usePublishTeamOrganization(serverUrl, token);
  return {
    state,
    reload: () => loadOrganization(registry, serverUrl, token, organizationId),
    publish,
  };
}

export function useTeamSessions(serverUrl: string, token: string) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(teamSessionsAtomFor(serverUrl, token));
  return { state, reload: () => loadTeamSessions(registry, serverUrl, token) };
}

function teamFailureMessage(error: unknown, serverUrl: string): string {
  return isTeamError(error) ? error.message : `Something went wrong talking to ${serverUrl}.`;
}

/** Runs one call at a time for a control: pending flag, readable error, success callback. */
export function useTeamTask(serverUrl: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = <A>(action: () => Promise<A>, onSuccess?: (value: A) => void) => {
    setPending(true);
    setError(null);
    return action().then(
      (value) => {
        setPending(false);
        onSuccess?.(value);
      },
      (failure: unknown) => {
        setPending(false);
        setError(teamFailureMessage(failure, serverUrl));
      },
    );
  };
  return { pending, error, run, clearError: () => setError(null) };
}

export function useTeamAuthConfig(serverUrl: string) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(teamAuthConfigAtomFor(serverUrl));
  return { state, reload: () => loadTeamAuthConfig(registry, serverUrl) };
}

export type GithubSignInState =
  | { readonly status: "idle" }
  | { readonly status: "starting" }
  | { readonly status: "waiting" }
  | { readonly status: "failed"; readonly message: string };

const GITHUB_POLL_INTERVAL_MS = 2_000;
const GITHUB_SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/** Opens GitHub in the browser, then polls the Team server until the sign-in resolves. */
export function useGithubSignIn(account: ReturnType<typeof useTeamAccount>) {
  const { api, deviceLabel, serverUrl, storeToken } = account;
  const [state, setState] = useState<GithubSignInState>({ status: "idle" });
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = () => {
    attempt.current += 1;
    clearTimeout(timer.current);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the poll timer outlives renders, so leaving the page has to cancel it
  useEffect(
    () => () => {
      attempt.current += 1;
      clearTimeout(timer.current);
    },
    [],
  );

  const start = async () => {
    stop();
    const mine = attempt.current;
    const deadline = Date.now() + GITHUB_SIGN_IN_TIMEOUT_MS;
    const fail = (message: string) => setState({ status: "failed", message });
    setState({ status: "starting" });
    let started;
    try {
      started = await api.githubStart(deviceLabel);
    } catch (failure) {
      if (mine === attempt.current) fail(teamFailureMessage(failure, serverUrl));
      return;
    }
    if (mine !== attempt.current) return;
    setState({ status: "waiting" });
    try {
      await ensureLocalApi().shell.openExternal(started.authorizeUrl);
    } catch {
      // Waiting stays on screen; the person can cancel and retry if the browser never opened.
    }
    const poll = async () => {
      if (mine !== attempt.current) return;
      if (Date.now() > deadline) {
        fail("GitHub sign-in timed out. Try again.");
        return;
      }
      try {
        const result = await api.githubPoll(started.state);
        if (mine !== attempt.current) return;
        if (result.status === "complete") {
          setState({ status: "idle" });
          storeToken(result.auth.token);
          return;
        }
        if (result.status === "failed") {
          fail(result.message);
          return;
        }
      } catch (failure) {
        if (mine !== attempt.current) return;
        if (isTeamError(failure) && failure.code !== "unreachable") {
          fail(failure.message);
          return;
        }
      }
      timer.current = setTimeout(() => void poll(), GITHUB_POLL_INTERVAL_MS);
    };
    timer.current = setTimeout(() => void poll(), GITHUB_POLL_INTERVAL_MS);
  };

  const cancel = () => {
    stop();
    setState({ status: "idle" });
  };

  return { state, start, cancel };
}
