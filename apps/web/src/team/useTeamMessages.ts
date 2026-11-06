import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext } from "react";

import { messagesAtomFor, unreadAtomFor, type MessagesScope } from "./messagesStore";
import { useTeamAccount } from "./useTeam";

/** The signed-in account's messages. `scope` is null when signed out. */
export function useTeamMessages() {
  const registry = useContext(RegistryContext);
  const { serverUrl, token, api } = useTeamAccount();
  const state = useAtomValue(messagesAtomFor(serverUrl, token));
  const scope: MessagesScope | null = token === null ? null : { registry, serverUrl, token };
  return { scope, state, api, serverUrl };
}

/** Unread messages across conversations; zero when signed out. */
export function useTeamUnread(): number {
  const { serverUrl, token } = useTeamAccount();
  return useAtomValue(unreadAtomFor(serverUrl, token));
}
