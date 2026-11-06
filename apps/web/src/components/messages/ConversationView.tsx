import type { TeamConversation, TeamMessage } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimarySettings } from "../../hooks/useSettings";
import {
  dayLabel,
  groupMessagesByDay,
  isOwnLiveMessage,
  MAX_MESSAGES_PER_CONVERSATION,
  startsMessageRun,
} from "../../team/messages.logic";
import {
  deleteMessage,
  discardMessage,
  ensureThread,
  loadEarlier,
  retryMessage,
  revealMessage,
  setReaction,
  type MessagesScope,
  type ThreadState,
} from "../../team/messagesStore";
import { TeamAvatar } from "../../team/TeamAvatar";
import { useTeamAccount } from "../../team/useTeam";
import { formatShortTimestamp } from "../../timestampFormat";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Popover, PopoverPopup } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { EmojiPicker } from "./EmojiPicker";
import { MessageComposer, type ComposerMode } from "./MessageComposer";
import { MessageMarkdown } from "./MessageMarkdown";
import { MessageRow, ReplyQuote, ThreadMessageRow } from "./MessageRow";

const NEAR_BOTTOM_PX = 96;
const HIGHLIGHT_MS = 1600;

interface Person {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

interface DeleteRequest {
  readonly message: TeamMessage;
  readonly busy: boolean;
  readonly error: string | null;
}

/** Scrolls a message into view and fades a highlight over it, without anything left animating. */
function revealRow(container: HTMLElement | null, messageId: string): boolean {
  const row = container?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (row === null || row === undefined) return false;
  row.scrollIntoView({ block: "center" });
  row.dataset.highlight = "true";
  window.setTimeout(() => {
    delete row.dataset.highlight;
  }, HIGHLIGHT_MS);
  return true;
}

function MessageList({
  scope,
  conversationId,
  conversation,
  thread,
  self,
  onReply,
  onEdit,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly conversation: TeamConversation;
  readonly thread: ThreadState;
  readonly self: Person;
  readonly onReply: (message: TeamMessage) => void;
  readonly onEdit: (message: TeamMessage) => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef({ nearBottom: true, firstId: null as string | null, key: "", height: 0 });
  const pendingJump = useRef<string | null>(null);
  const [picker, setPicker] = useState<{ messageId: string; anchor: HTMLElement } | null>(null);
  const [deleting, setDeleting] = useState<DeleteRequest | null>(null);
  const { peer } = conversation;
  const groups = groupMessagesByDay(thread.messages);
  const firstId = thread.messages[0]?.id ?? null;
  const endKey = `${thread.messages.at(-1)?.id ?? ""}:${thread.pending.length}`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the scroll container after the DOM updates: bottom on open and on new messages when already there, same place when older messages are prepended, then on a reply's original once it is rendered
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const previous = anchor.current;
    const prepended =
      previous.firstId !== null && firstId !== previous.firstId && previous.key === endKey;
    if (prepended) {
      element.scrollTop += element.scrollHeight - previous.height;
    } else if (previous.nearBottom) {
      element.scrollTop = element.scrollHeight;
    }
    anchor.current = { ...previous, firstId, key: endKey, height: element.scrollHeight };
    const target = pendingJump.current;
    if (target !== null && revealRow(element, target)) pendingJump.current = null;
  }, [firstId, endKey]);

  const jumpTo = useStableCallback(async (messageId: string) => {
    if (revealRow(scrollRef.current, messageId)) return;
    pendingJump.current = messageId;
    const found = await revealMessage(scope, conversationId, messageId);
    if (!found) {
      pendingJump.current = null;
      toastManager.add({
        type: "info",
        title: "Original message not available",
        description: "It is too far back to load here.",
      });
    }
  });

  const toggleReaction = useStableCallback(async (message: TeamMessage, emoji: string) => {
    const mine = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(self.id);
    const error = await setReaction(
      scope,
      conversationId,
      message.id,
      emoji,
      self.id,
      mine !== true,
    );
    if (error !== null) {
      toastManager.add({ type: "error", title: "Couldn't update reaction", description: error });
    }
  });
  const openPicker = useStableCallback((message: TeamMessage, element: HTMLElement) =>
    setPicker({ messageId: message.id, anchor: element }),
  );
  const pickEmoji = (emoji: string) => {
    const message = thread.messages.find((entry) => entry.id === picker?.messageId);
    setPicker(null);
    if (message !== undefined) void toggleReaction(message, emoji);
  };
  const askDelete = useStableCallback((message: TeamMessage) =>
    setDeleting({ message, busy: false, error: null }),
  );
  const confirmDelete = async () => {
    if (deleting === null) return;
    setDeleting({ ...deleting, busy: true, error: null });
    const error = await deleteMessage(scope, conversationId, deleting.message.id);
    setDeleting(error === null ? null : { ...deleting, busy: false, error });
  };

  const canLoadEarlier = thread.hasMore && thread.messages.length < MAX_MESSAGES_PER_CONVERSATION;

  return (
    <div
      ref={scrollRef}
      className="scrollbar-gutter-both flex min-h-0 flex-1 flex-col overflow-y-auto py-4"
      onScroll={(event) => {
        const element = event.currentTarget;
        anchor.current.nearBottom =
          element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_PX;
      }}
    >
      {canLoadEarlier ? (
        <Button
          size="sm"
          variant="ghost"
          className="mb-2 self-center"
          disabled={thread.loadingEarlier}
          onClick={() => void loadEarlier(scope, conversationId)}
        >
          {thread.loadingEarlier ? <Spinner className="size-4" /> : null}
          Load earlier messages
        </Button>
      ) : null}
      {thread.error !== null && thread.status === "ready" ? (
        <p role="alert" className="mb-2 self-center text-xs text-destructive-foreground">
          {thread.error}
        </p>
      ) : null}
      {thread.messages.length === 0 && thread.pending.length === 0 ? (
        <p className="m-auto text-sm text-muted-foreground">Say hello to {peer.name}.</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} aria-label={dayLabel(group.startedAt)} className="flex flex-col">
          <h2 className="relative mt-5 mb-2 flex items-center px-5 text-xs font-medium text-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="mx-3 rounded-full border border-border px-3 py-0.5">
              {dayLabel(group.startedAt)}
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </h2>
          {group.messages.map((message, index) => {
            const mine = message.senderId === self.id;
            return (
              <ThreadMessageRow
                key={message.id}
                message={message}
                authorName={mine ? self.name : peer.name}
                authorAvatarUrl={mine ? self.avatarUrl : peer.avatarUrl}
                startsRun={startsMessageRun(group.messages[index - 1], message)}
                gapBefore={index > 0}
                time={formatShortTimestamp(message.createdAt, timestampFormat)}
                selfId={self.id}
                selfName={self.name}
                peerId={peer.id}
                peerName={peer.name}
                pickerOpen={picker?.messageId === message.id}
                onReact={openPicker}
                onToggleReaction={toggleReaction}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={askDelete}
                onJump={jumpTo}
              />
            );
          })}
        </section>
      ))}
      {thread.pending.map((entry, index) => {
        const previous = index === 0 ? thread.messages.at(-1) : undefined;
        const original =
          entry.replyToId === null
            ? undefined
            : thread.messages.find((message) => message.id === entry.replyToId);
        return (
          <MessageRow
            key={entry.localId}
            authorName={self.name}
            authorAvatarUrl={self.avatarUrl}
            startsRun={index === 0 ? previous?.senderId !== self.id : false}
            gapBefore
            time=""
            dimmed={entry.status === "sending"}
            quote={
              original === undefined ? null : (
                <ReplyQuote
                  name={original.senderId === self.id ? self.name : peer.name}
                  original={original}
                />
              )
            }
            footer={
              entry.status === "sending" ? (
                <span className="text-3xs text-muted-foreground">Sending…</span>
              ) : (
                <span role="alert" className="flex items-center gap-2 text-xs">
                  <span className="text-destructive-foreground">{entry.error ?? "Not sent."}</span>
                  <Button
                    size="micro"
                    variant="ghost"
                    onClick={() => void retryMessage(scope, conversationId, entry.localId)}
                  >
                    Retry
                  </Button>
                  <Button
                    size="micro"
                    variant="ghost-muted"
                    onClick={() => discardMessage(scope, conversationId, entry.localId)}
                  >
                    Discard
                  </Button>
                </span>
              )
            }
          >
            <MessageMarkdown body={entry.body} />
          </MessageRow>
        );
      })}
      <Popover open={picker !== null} onOpenChange={(open) => (open ? undefined : setPicker(null))}>
        <PopoverPopup anchor={picker?.anchor} side="top" align="end" width="sm" padding="compact">
          <EmojiPicker onPick={pickEmoji} />
        </PopoverPopup>
      </Popover>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && deleting?.busy !== true) setDeleting(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed for both of you and can't be brought back. Replies to it keep showing
              that it was deleted.
            </AlertDialogDescription>
            {deleting?.error ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {deleting.error}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={deleting?.busy === true}
              render={<Button variant="outline" disabled={deleting?.busy === true} />}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deleting?.busy === true}
              onClick={() => void confirmDelete()}
            >
              {deleting?.busy ? <Spinner size="sm" /> : null}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

let nextModeSerial = 0;

function modeRequest(kind: "reply" | "edit", message: TeamMessage) {
  nextModeSerial += 1;
  return { kind, messageId: message.id, serial: nextModeSerial };
}

export function ConversationView({
  scope,
  conversationId,
  conversation,
  thread,
  listReady,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly conversation: TeamConversation | undefined;
  readonly thread: ThreadState | undefined;
  readonly listReady: boolean;
}) {
  const account = useTeamAccount();
  const [request, setRequest] = useState<{
    kind: "reply" | "edit";
    messageId: string;
    serial: number;
  } | null>(null);
  const onReply = useStableCallback((message: TeamMessage) =>
    setRequest(modeRequest("reply", message)),
  );
  const onEdit = useStableCallback((message: TeamMessage) =>
    setRequest(modeRequest("edit", message)),
  );
  if (conversation === undefined) {
    const failed = thread?.status === "failed";
    return listReady || failed ? (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>Conversation not found</EmptyTitle>
          <EmptyDescription>{failed ? thread.error : "It may have been removed."}</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" render={<Link to="/messages" />}>
          Back to messages
        </Button>
      </Empty>
    ) : (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-4" />
      </div>
    );
  }
  const { peer } = conversation;
  const me = account.session.status === "ready" ? account.session.me.user : null;
  const self = { id: me?.id ?? "", name: me?.name ?? "You", avatarUrl: me?.avatarUrl ?? null };
  const target =
    request === null ? undefined : thread?.messages.find((entry) => entry.id === request.messageId);
  // A target that was deleted, or an edit of a message that is no longer yours to change, ends the mode.
  const mode: ComposerMode | null =
    request === null ||
    target === undefined ||
    target.deleted ||
    (request.kind === "edit" && !isOwnLiveMessage(target, self.id))
      ? null
      : {
          kind: request.kind,
          message: target,
          authorName: target.senderId === self.id ? "yourself" : peer.name,
          serial: request.serial,
        };
  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <TeamAvatar name={peer.name} avatarUrl={peer.avatarUrl} />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-medium">{peer.name}</h2>
          <span className="truncate text-xs text-muted-foreground">@{peer.githubLogin}</span>
        </div>
      </div>
      {thread === undefined || (thread.status === "loading" && thread.messages.length === 0) ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-4" />
        </div>
      ) : thread.status === "failed" ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Couldn't load messages</EmptyTitle>
            <EmptyDescription>{thread.error}</EmptyDescription>
          </EmptyHeader>
          <Button size="sm" onClick={() => ensureThread(scope, conversationId)}>
            Try again
          </Button>
        </Empty>
      ) : (
        <>
          <MessageList
            scope={scope}
            conversationId={conversationId}
            conversation={conversation}
            thread={thread}
            self={self}
            onReply={onReply}
            onEdit={onEdit}
          />
          <MessageComposer
            key={conversationId}
            scope={scope}
            conversationId={conversationId}
            sending={thread.pending.some((entry) => entry.status === "sending")}
            mode={mode}
            onModeDone={() => setRequest(null)}
          />
        </>
      )}
    </>
  );
}
