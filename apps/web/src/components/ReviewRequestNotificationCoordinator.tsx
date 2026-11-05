import { resolveChangeRequestLinkTarget } from "@t3tools/client-runtime/change-request-links";
import type { EnvironmentId, PullRequestReviewRequestNotice } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { getClientSettings, subscribeClientSettings } from "../hooks/useSettings";
import { readPrimaryEnvironmentId } from "../state/environments";
import { readProjects } from "../state/entities";
import { environmentSummaries } from "../state/presentation";
import { pullRequestEnvironment } from "../state/pullRequests";
import { environmentServerConfigsAtom } from "../state/server";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../threadNotifications";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "./pullRequest/pullRequestListPreferences";
import { toastManager } from "./ui/toast";

const SEEN_LIMIT = 200;

/**
 * Announces each new review request the server hears about, with the thread notification
 * settings. Several environments may poll the same account, so a request is told once.
 */
export function startReviewRequestNotifications(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  const seen = new Set<string>();
  const watched = new Map<EnvironmentId, () => void>();

  const open = (environmentId: EnvironmentId, notice: PullRequestReviewRequestNotice) => {
    const serverConfigs = registry.get(environmentServerConfigsAtom);
    const target = resolveChangeRequestLinkTarget({
      url: notice.url,
      projects: readProjects(),
      configLoaded: (id) => serverConfigs.has(id),
      environmentId,
      primaryEnvironmentId: readPrimaryEnvironmentId(),
      lendHostProject: true,
    });
    if (target === null) {
      window.open(notice.url, "_blank", "noopener,noreferrer");
      return;
    }
    void router.navigate({
      to: "/pull-requests",
      search: {
        ...readPullRequestListPreferences(),
        repository: target.repository,
        number: target.number,
        selectedProjectId: target.project.id,
        selectedEnvironmentId: target.project.environmentId,
        ...(target.host === undefined ? {} : { selectedHost: target.host }),
      },
    });
  };

  const present = (environmentId: EnvironmentId, notice: PullRequestReviewRequestNotice) => {
    const key = `${notice.host}/${notice.repository}#${notice.number}@${notice.requestedAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);

    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    const title = "Review requested";
    const body = `${notice.repository} #${notice.number}: ${notice.title}`;
    const looking = document.visibilityState === "visible" && document.hasFocus();
    if (hasNotificationSound(mode)) {
      void playNotificationSound("input", () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (looking) {
      if (!inAppNotificationsEnabled) return;
      const toastId = toastManager.add({
        type: "info",
        title,
        description: body,
        data: {
          hideCopyButton: true,
          leadingIcon: (
            <PullRequestGlyph.pullRequest aria-hidden className="size-4 text-info-foreground" />
          ),
        },
        actionProps: {
          children: "Open pull request",
          onClick: () => {
            toastManager.close(toastId);
            open(environmentId, notice);
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
        tag: `review-request:${key}`,
        silent: true,
      });
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
        open(environmentId, notice);
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };

  const watch = (environmentId: EnvironmentId) => {
    let last: PullRequestReviewRequestNotice | null | undefined;
    return registry.subscribe(
      pullRequestEnvironment.reviewRequests({ environmentId, input: {} }),
      (result) => {
        const notice = AsyncResult.getOrElse(result, () => null);
        const baseline = last === undefined;
        if (notice === last) return;
        last = notice;
        // A value already held when watching starts was announced, or arrived while off.
        if (baseline || notice === null) return;
        present(environmentId, notice);
      },
      { immediate: true },
    );
  };

  const sync = () => {
    const { notificationMode, inAppNotificationsEnabled } = getClientSettings();
    const enabled = notificationMode !== "off" || inAppNotificationsEnabled;
    const environmentIds = new Set(
      enabled ? registry.get(environmentSummaries.environmentIdsAtom) : [],
    );
    for (const [environmentId, stop] of watched) {
      if (environmentIds.has(environmentId)) continue;
      stop();
      watched.delete(environmentId);
    }
    for (const environmentId of environmentIds) {
      if (!watched.has(environmentId)) watched.set(environmentId, watch(environmentId));
    }
  };

  const unsubscribeSettings = subscribeClientSettings(sync);
  const unsubscribeEnvironmentIds = registry.subscribe(
    environmentSummaries.environmentIdsAtom,
    sync,
  );
  sync();

  return () => {
    unsubscribeSettings();
    unsubscribeEnvironmentIds();
    for (const stop of watched.values()) stop();
    watched.clear();
  };
}
