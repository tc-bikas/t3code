import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useEffectEvent } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadShell } from "~/state/entities";
import { usePullRequestsSupported } from "~/state/environments";
import { usePullRequestList } from "~/state/pullRequests";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

const LIST_LIMIT = 30;
const REFRESH_INTERVAL_MS = 3 * 60_000;
const REVIEW_SHELF_EXPANDED_KEY = "t3code:sidebar:review-expanded";

/**
 * Open pull requests asking you to review, for the project of the thread you are in. Empty when
 * there is no project, the host has no pull requests, or nothing is waiting.
 */
export function useReviewRequests(input: {
  threadRef: ScopedThreadRef | null;
  draftProjectRef: ScopedProjectRef | null;
}) {
  const supported = usePullRequestsSupported();
  const shell = useThreadShell(input.threadRef);
  const projectRef = shell
    ? scopeProjectRef(shell.environmentId, shell.projectId)
    : input.draftProjectRef;
  const list = usePullRequestList(
    supported && projectRef
      ? [
          {
            environmentId: projectRef.environmentId,
            input: {
              state: "open",
              involvement: "reviewing",
              limit: LIST_LIMIT,
              projectId: projectRef.projectId,
            },
          },
        ]
      : [],
  );
  const refreshList = useEffectEvent(() => list.refresh());
  const watching = projectRef !== null && supported;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the list is not polled by the server, so a merged or closed pull request leaves it on the next refetch
  useEffect(() => {
    if (!watching) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshList();
    };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshList);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshList);
    };
  }, [watching]);
  // A merged or closed pull request needs no review, whoever merged it and whether or not you did.
  return (list.data?.entries ?? []).filter(
    (entry) => entry.state === "open" && entry.viewerReviewRequested,
  );
}

/** A shelf above Settled: a collapsible header and one row per pull request. */
export function SidebarReviewShelf(props: {
  entries: ReturnType<typeof useReviewRequests>;
  threadRef: ScopedThreadRef | null;
  className?: string;
}) {
  const [expanded, setExpanded] = useLocalStorage(REVIEW_SHELF_EXPANDED_KEY, true, Schema.Boolean);
  // The panel opens beside the thread, so the sidebar and the open thread stay as they are.
  const openInPanel = (entry: (typeof props.entries)[number]) => {
    const { threadRef } = props;
    if (threadRef === null) return;
    useRightPanelStore.getState().openPullRequest(threadRef, {
      ...(threadRef.environmentId === entry.environmentId
        ? {}
        : { environmentId: entry.environmentId }),
      projectId: entry.projectId,
      host: entry.host,
      repository: entry.repository,
      url: entry.url,
      number: entry.number,
    });
  };
  return (
    <>
      <li className={cn("relative mx-0.5 h-8 list-none", props.className)}>
        <CollapsibleSectionHeader
          data-sidebar-row="shelf:review"
          data-testid="sidebar-review-shelf-toggle"
          expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          accessory={<span className="font-normal tabular-nums">{props.entries.length}</span>}
        >
          Awaiting your review
        </CollapsibleSectionHeader>
      </li>
      {expanded
        ? props.entries.map((entry) => (
            <li
              className="list-none"
              key={`${entry.environmentId}:${entry.projectId}:${entry.number}`}
            >
              <button
                type="button"
                data-sidebar-row={`review:${entry.environmentId}:${entry.projectId}:${entry.number}`}
                onClick={() => openInPanel(entry)}
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              >
                <PullRequestGlyph.pullRequest className="size-4 shrink-0 text-warning" />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-xs tabular-nums">#{entry.number}</span>
              </button>
            </li>
          ))
        : null}
    </>
  );
}
