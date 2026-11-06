import type { TeamConversation } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, type ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  dayLabel,
  groupMessagesByDay,
  MAX_MESSAGES_PER_CONVERSATION,
  startsMessageRun,
} from "../../team/messages.logic";
import {
  discardMessage,
  ensureThread,
  loadEarlier,
  retryMessage,
  type MessagesScope,
  type ThreadState,
} from "../../team/messagesStore";
import { TeamAvatar } from "../../team/TeamAvatar";
import { useTeamAccount } from "../../team/useTeam";
import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { MessageComposer } from "./MessageComposer";
import { MessageMarkdown } from "./MessageMarkdown";

const NEAR_BOTTOM_PX = 96;

/** Slack-style row: everyone's messages sit left, the name and avatar open each run. */
function MessageRow({
  author,
  startsRun,
  gapBefore,
  time,
  dimmed = false,
  children,
  footer,
}: {
  readonly author: { readonly name: string; readonly avatarUrl: string | null };
  readonly startsRun: boolean;
  /** Space above a run that follows other messages; grouped messages sit closer. */
  readonly gapBefore: boolean;
  readonly time: string;
  readonly dimmed?: boolean;
  readonly children: string;
  readonly footer?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/message mx-2 flex gap-3 rounded-lg px-3 py-0.5 hover:bg-accent/40",
        startsRun && "pt-1",
        startsRun && gapBefore && "mt-4",
      )}
    >
      <div className="w-10 shrink-0 self-start">
        {startsRun ? (
          <TeamAvatar name={author.name} avatarUrl={author.avatarUrl} />
        ) : (
          <span className="hidden pt-1.5 text-right text-3xs text-muted-foreground tabular-nums group-hover/message:block">
            {time}
          </span>
        )}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col", dimmed && "opacity-64")}>
        {startsRun ? (
          <div className="flex items-baseline gap-2 leading-6">
            <span className="truncate text-sm font-semibold">{author.name}</span>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
        ) : null}
        <MessageMarkdown body={children} />
        {footer}
      </div>
    </div>
  );
}

function MessageList({
  scope,
  conversationId,
  conversation,
  thread,
  self,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly conversation: TeamConversation;
  readonly thread: ThreadState;
  readonly self: { readonly id: string; readonly name: string; readonly avatarUrl: string | null };
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef({ nearBottom: true, firstId: null as string | null, key: "", height: 0 });
  const groups = groupMessagesByDay(thread.messages);
  const firstId = thread.messages[0]?.id ?? null;
  const endKey = `${thread.messages.at(-1)?.id ?? ""}:${thread.pending.length}`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the scroll container after the DOM updates: bottom on open and on new messages when already there, same place when older messages are prepended
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
  }, [firstId, endKey]);

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
        <p className="m-auto text-sm text-muted-foreground">
          Say hello to {conversation.peer.name}.
        </p>
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
          {group.messages.map((message, index) => (
            <MessageRow
              key={message.id}
              author={message.senderId === self.id ? self : conversation.peer}
              startsRun={startsMessageRun(group.messages[index - 1], message)}
              gapBefore={index > 0}
              time={formatShortTimestamp(message.createdAt, timestampFormat)}
            >
              {message.body}
            </MessageRow>
          ))}
        </section>
      ))}
      {thread.pending.map((entry, index) => {
        const previous = index === 0 ? thread.messages.at(-1) : undefined;
        return (
          <MessageRow
            key={entry.localId}
            author={self}
            startsRun={index === 0 ? previous?.senderId !== self.id : false}
            gapBefore
            time=""
            dimmed={entry.status === "sending"}
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
            {entry.body}
          </MessageRow>
        );
      })}
    </div>
  );
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
          />
          <MessageComposer
            key={conversationId}
            scope={scope}
            conversationId={conversationId}
            sending={thread.pending.some((entry) => entry.status === "sending")}
          />
        </>
      )}
    </>
  );
}
