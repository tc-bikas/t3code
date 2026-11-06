import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { TeamMembership, TeamOrganizationDetail } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useContext, useState } from "react";

import { isElectron } from "../env";
import { useLocalStorage } from "../hooks/useLocalStorage";
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
  loadTeamSessions,
  refreshTeamSession,
  setTeamOrganizationDetail,
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
