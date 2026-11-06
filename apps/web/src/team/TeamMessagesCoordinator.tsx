import type { TeamConversation, TeamMessage } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";
import { MessageCircleIcon } from "lucide-react";

import { toastManager } from "../components/ui/toast";
import { readLocalStorageValue, subscribeLocalStorageKey } from "../hooks/useLocalStorage";
import { getClientSettings } from "../hooks/useSettings";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../threadNotifications";
import {
  isIncomingMessage,
  openConversationId,
  messagePreview,
  reconnectDelayMs,
} from "./messages.logic";
import {
  applyTeamEvent,
  clearMessages,
  ensureThread,
  loadConversations,
  refreshLoadedThreads,
  scheduleMarkRead,
  type MessagesScope,
} from "./messagesStore";
import { DEFAULT_TEAM_SERVER_URL } from "./team.logic";
import { isTeamError, streamTeamEvents } from "./teamClient";
import {
  NO_TEAM_TOKENS,
  TEAM_SERVER_URL_KEY,
  TEAM_TOKENS_KEY,
  TeamTokens,
  writeTeamToken,
} from "./teamStore";

const NOTIFICATION_BODY_LENGTH = 140;

const looking = () => document.visibilityState === "visible" && document.hasFocus();

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

function announce(router: AnyRouter, conversation: TeamConversation, message: TeamMessage): void {
  const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
  const title = conversation.peer.name;
  const body = messagePreview(message, NOTIFICATION_BODY_LENGTH);
  const open = () =>
    void router.navigate({
      to: "/messages/$conversationId",
      params: { conversationId: conversation.id },
    });
  if (hasNotificationSound(mode)) {
    void playNotificationSound("input", () =>
      hasNotificationSound(getClientSettings().notificationMode),
    );
  }
  if (looking()) {
    if (!inAppNotificationsEnabled) return;
    const toastId = toastManager.add({
      type: "info",
      title,
      description: body,
      data: {
        hideCopyButton: true,
        leadingIcon: <MessageCircleIcon aria-hidden className="size-4 text-info-foreground" />,
      },
      actionProps: {
        children: "Open",
        onClick: () => {
          toastManager.close(toastId);
          open();
        },
      },
    });
    return;
  }
  if (
    !hasDesktopNotifications(mode) ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const notification = new Notification(title, {
      body,
      tag: `team-message:${conversation.id}`,
      silent: true,
    });
    notification.addEventListener("click", () => {
      notification.close();
      window.focus();
      void window.desktopBridge?.revealWindow().catch(() => undefined);
      open();
    });
  } catch {
    // Some browsers expose Notification but reject desktop presentation.
  }
}

/** Keeps the event stream and the conversation list current for one signed-in session. */
function connect(scope: MessagesScope, router: AnyRouter): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  const syncOpenConversation = () => {
    const id = openConversationId(router.state.location.pathname);
    if (id === null) return;
    ensureThread(scope, id);
    if (looking()) scheduleMarkRead(scope, id);
  };

  const run = async () => {
    let attempt = 0;
    // Shows a failure on the page even while the stream cannot connect.
    void loadConversations(scope);
    while (!signal.aborted) {
      try {
        await streamTeamEvents(scope.serverUrl, scope.token, signal, {
          onOpen: () => {
            attempt = 0;
            void loadConversations(scope).then(() => {
              if (signal.aborted) return;
              refreshLoadedThreads(scope);
              syncOpenConversation();
            });
          },
          onEvent: (event) => {
            applyTeamEvent(scope, event);
            if (event.type !== "message" || !isIncomingMessage(event.message, event.conversation)) {
              return;
            }
            const openId = openConversationId(router.state.location.pathname);
            if (openId === event.conversation.id && looking()) {
              scheduleMarkRead(scope, openId);
            } else {
              announce(router, event.conversation, event.message);
            }
          },
        });
      } catch (error) {
        if (isTeamError(error) && error.code === "unauthorized") {
          writeTeamToken(scope.serverUrl, null);
          return;
        }
      }
      if (signal.aborted) return;
      await waitFor(reconnectDelayMs(attempt++), signal);
    }
  };
  void run();
  syncOpenConversation();

  const unsubscribeRouter = router.subscribe("onResolved", syncOpenConversation);
  window.addEventListener("focus", syncOpenConversation);

  return () => {
    controller.abort();
    unsubscribeRouter();
    window.removeEventListener("focus", syncOpenConversation);
    clearMessages(scope);
  };
}

/**
 * While a Team account is signed in, holds the message stream open. Signing out or changing
 * the Team server stops it and drops what it loaded.
 */
export function startTeamMessages(registry: AtomRegistry.AtomRegistry, router: AnyRouter): void {
  let activeKey: string | null = null;
  let stop: (() => void) | null = null;
  const sync = () => {
    const serverUrl = readLocalStorageValue(
      TEAM_SERVER_URL_KEY,
      DEFAULT_TEAM_SERVER_URL,
      Schema.String,
    );
    const token = readLocalStorageValue(TEAM_TOKENS_KEY, NO_TEAM_TOKENS, TeamTokens)[serverUrl];
    const key = token === undefined ? null : JSON.stringify([serverUrl, token]);
    if (key === activeKey) return;
    activeKey = key;
    stop?.();
    stop = token === undefined ? null : connect({ registry, serverUrl, token }, router);
  };
  subscribeLocalStorageKey(TEAM_SERVER_URL_KEY, sync);
  subscribeLocalStorageKey(TEAM_TOKENS_KEY, sync);
  sync();
}
