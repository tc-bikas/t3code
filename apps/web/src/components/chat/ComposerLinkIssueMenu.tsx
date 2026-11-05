import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentAuthorizationError,
  type EnvironmentId,
  TrellisError,
  type TrellisIssue,
  type TrellisStatus,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { ArrowRightIcon, CornerDownLeftIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { ensureLocalApi } from "~/localApi";
import { trellisEnvironment } from "~/state/trellis";
import { useAtomCommand } from "~/state/use-atom-command";

import { TrellisIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandListHeading,
  CommandShortcut,
} from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";
import { formatIssueReference, resolveLinkIssueView } from "./composerLinkIssue";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;
const GENERIC_FAILURE = "Something went wrong talking to Trellis. Try again.";

const isUserFacingFailure = Schema.is(Schema.Union([TrellisError, EnvironmentAuthorizationError]));

/** Only the server's written messages reach the screen, never a raw payload. */
const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return isUserFacingFailure(error) ? error.message : GENERIC_FAILURE;
};

type ConnectAttempt =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "waiting"; readonly authorizeUrl: string };

type SearchState =
  | { readonly phase: "idle" }
  | { readonly phase: "searching" }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "done" };

function SetupRow(props: {
  readonly value: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly icon?: "trellis" | "external";
}) {
  return (
    <CommandItem value={props.value} disabled={props.disabled} onClick={props.onSelect}>
      <TrellisIcon className="size-5 shrink-0" />
      {props.busy ? (
        <Spinner className="size-4 shrink-0" />
      ) : props.icon === "external" ? (
        <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0 text-icon-muted" />
      ) : (
        <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-icon-muted" />
      )}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <CommandShortcut>
        <span className="flex items-center gap-1.5">
          Setup
          <CornerDownLeftIcon aria-hidden="true" className="size-3.5" />
        </span>
      </CommandShortcut>
    </CommandItem>
  );
}

function Note(props: { readonly children: string }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{props.children}</p>;
}

/**
 * A + before the send button. Its menu opens an issue search; Trellis connects from inside the
 * dialog, so the list starts with whatever setup step is missing.
 */
export function ComposerLinkIssueMenu(props: {
  disabled: boolean;
  environmentId: EnvironmentId;
  onInsertText: (text: string) => boolean;
}) {
  const { environmentId } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TrellisStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ConnectAttempt>({ phase: "idle" });
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  const [issues, setIssues] = useState<ReadonlyArray<TrellisIssue>>([]);
  const latestSearch = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const canConnect = useAtomValue(trellisEnvironment.startConnect.permissionAtom(environmentId));
  const canDisconnect = useAtomValue(trellisEnvironment.disconnect.permissionAtom(environmentId));
  const checkStatus = useAtomCommand(trellisEnvironment.status, { reportFailure: false });
  const startConnect = useAtomCommand(trellisEnvironment.startConnect, { reportFailure: false });
  const searchIssues = useAtomCommand(trellisEnvironment.searchIssues, { reportFailure: false });
  const disconnect = useAtomCommand(trellisEnvironment.disconnect, { reportFailure: false });

  const view = resolveLinkIssueView({
    status,
    statusError,
    waitingForTrellis: attempt.phase === "waiting",
  });

  const runSearch = async (text: string) => {
    const requestId = ++latestSearch.current;
    setSearch({ phase: "searching" });
    const result = await searchIssues({
      environmentId,
      input: { query: text, limit: SEARCH_LIMIT },
    });
    // A newer search, or closing the dialog, owns the list by now.
    if (requestId !== latestSearch.current) return;
    if (result._tag === "Success") {
      setIssues(result.value.issues);
      setSearch({ phase: "done" });
    } else {
      setSearch({ phase: "failed", message: failureMessage(result.cause) });
    }
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    clearTimeout(searchTimer.current);
    if (view.kind !== "connected") return;
    searchTimer.current = setTimeout(() => void runSearch(value.trim()), SEARCH_DEBOUNCE_MS);
  };

  const refreshStatus = async () => {
    const result = await checkStatus({ environmentId, input: {} });
    if (result._tag !== "Success") {
      setStatusError(failureMessage(result.cause));
      return;
    }
    setStatusError(null);
    setStatus(result.value);
    if (result.value.state === "connected") {
      setAttempt({ phase: "idle" });
      void runSearch(query.trim());
    }
  };

  const recheckStatus = useStableCallback(() => void refreshStatus());

  const close = (next: boolean) => {
    setOpen(next);
    if (next) {
      void refreshStatus();
      return;
    }
    setQuery("");
    setSearch({ phase: "idle" });
    setIssues([]);
    clearTimeout(searchTimer.current);
    latestSearch.current += 1;
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Trellis approval happens in another window, so coming back to this one is the signal to ask the server again
  useEffect(() => {
    if (!open || attempt.phase !== "waiting") return;
    window.addEventListener("focus", recheckStatus);
    return () => window.removeEventListener("focus", recheckStatus);
  }, [open, attempt.phase, recheckStatus]);

  const openTrellis = async (authorizeUrl: string) => {
    try {
      await ensureLocalApi().shell.openExternal(authorizeUrl);
    } catch {
      // A blocked popup leaves the "Open Trellis again" row, which opens it from a click.
    }
  };

  const connect = async () => {
    setAttempt({ phase: "starting" });
    const result = await startConnect({
      environmentId,
      input: { origin: window.location.origin },
    });
    if (result._tag !== "Success") {
      setAttempt({ phase: "failed", message: failureMessage(result.cause) });
      return;
    }
    setAttempt({ phase: "waiting", authorizeUrl: result.value.authorizeUrl });
    await openTrellis(result.value.authorizeUrl);
  };

  const disconnectTrellis = async () => {
    const result = await disconnect({ environmentId, input: {} });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Couldn't disconnect Trellis",
        description: failureMessage(result.cause),
      });
      return;
    }
    setAttempt({ phase: "idle" });
    setSearch({ phase: "idle" });
    setIssues([]);
    await refreshStatus();
  };

  const pick = (issue: TrellisIssue) => {
    close(false);
    const inserted = props.onInsertText(formatIssueReference(issue));
    if (!inserted) {
      toastManager.add({ type: "error", title: "Couldn't add the issue to the message" });
    }
  };

  return (
    <>
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                disabled={props.disabled}
                render={
                  <Button variant="ghost-muted" size="icon-sm" aria-label="Link issues">
                    <PlusIcon aria-hidden="true" />
                  </Button>
                }
              />
            }
          />
          <TooltipPopup>Link issues</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
          <MenuItem onClick={() => close(true)}>
            <TrellisIcon className="size-4" />
            Link issue
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={open} onOpenChange={close}>
        <DialogPopup className="max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Link issues</DialogTitle>
          <Command mode="none" value={query} onValueChange={changeQuery} aria-label="Link issues">
            <CommandInput placeholder="Search issues…" />
            <CommandList>
              {view.kind === "connected" ? (
                <>
                  <CommandListHeading>Issues</CommandListHeading>
                  {search.phase === "searching" && issues.length === 0 ? (
                    <Note>Searching…</Note>
                  ) : null}
                  {search.phase === "failed" ? <Note>{search.message}</Note> : null}
                  {search.phase === "done" && issues.length === 0 ? (
                    <Note>No issues found.</Note>
                  ) : null}
                  {issues.map((issue) => (
                    <CommandItem key={issue.id} value={issue.id} onClick={() => pick(issue)}>
                      <span className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">
                        {issue.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                      {issue.statusName === undefined ? null : (
                        <CommandShortcut>{issue.statusName}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </>
              ) : null}
              <CommandListHeading>Setup</CommandListHeading>
              {view.kind === "checking" ? <Note>Checking Trellis…</Note> : null}
              {view.kind === "error" ? <Note>{view.message}</Note> : null}
              {view.kind === "error" ? (
                <SetupRow
                  value="check-trellis-again"
                  label="Check again"
                  onSelect={() => void refreshStatus()}
                />
              ) : null}
              {view.kind === "not-configured" ? <Note>{view.message}</Note> : null}
              {view.kind === "disconnected" ? (
                <>
                  {attempt.phase === "failed" ? <Note>{attempt.message}</Note> : null}
                  <SetupRow
                    value="connect-trellis"
                    label="Connect Trellis"
                    disabled={!canConnect || attempt.phase === "starting"}
                    busy={attempt.phase === "starting"}
                    onSelect={() => void connect()}
                  />
                </>
              ) : null}
              {view.kind === "waiting" && attempt.phase === "waiting" ? (
                <>
                  <Note>Waiting for Trellis… Approve T3 Code in the tab that opened.</Note>
                  <SetupRow
                    value="open-trellis-again"
                    label="Open Trellis again"
                    icon="external"
                    onSelect={() => void openTrellis(attempt.authorizeUrl)}
                  />
                  <SetupRow
                    value="check-trellis-again"
                    label="Check again"
                    onSelect={() => void refreshStatus()}
                  />
                </>
              ) : null}
              {view.kind === "connected" ? (
                <SetupRow
                  value="disconnect-trellis"
                  label="Disconnect Trellis"
                  disabled={!canDisconnect}
                  onSelect={() => void disconnectTrellis()}
                />
              ) : null}
            </CommandList>
          </Command>
        </DialogPopup>
      </Dialog>
    </>
  );
}
