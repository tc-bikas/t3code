import { TEAM_MESSAGE_MAX_LENGTH, type TeamConversation } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  dayLabel,
  groupMessagesByDay,
  isIncomingMessage,
  MAX_MESSAGES_PER_CONVERSATION,
  showsMessageCounter,
} from "../../team/messages.logic";
import {
  discardMessage,
  ensureThread,
  loadEarlier,
  retryMessage,
  sendMessage,
  type MessagesScope,
  type ThreadState,
} from "../../team/messagesStore";
import { TeamAvatar } from "../../team/TeamAvatar";
import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

const NEAR_BOTTOM_PX = 96;

function Bubble({
  own,
  time,
  children,
}: {
  readonly own: boolean;
  readonly time: string;
  readonly children: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", own ? "items-end" : "items-start")}>
      <p
        className={cn(
          "max-w-[min(36rem,85%)] rounded-2xl px-3 py-1.5 text-sm wrap-anywhere whitespace-pre-wrap",
          own ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
        )}
      >
        {children}
      </p>
      <span className="px-1 text-3xs text-muted-foreground">{time}</span>
    </div>
  );
}

function Composer({
  scope,
  conversationId,
  sending,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly sending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const body = draft.trim();
  const tooLong = draft.length > TEAM_MESSAGE_MAX_LENGTH;
  const canSend = body !== "" && !tooLong && !sending;
  const send = () => {
    if (!canSend) return;
    setDraft("");
    void sendMessage(scope, conversationId, body);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="flex flex-col gap-1 border-t border-border p-3">
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Message"
          placeholder="Write a message"
          value={draft}
          aria-invalid={tooLong || undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button disabled={!canSend} onClick={send}>
          {sending ? <Spinner className="size-4" /> : null}
          Send
        </Button>
      </div>
      {showsMessageCounter(draft.length, TEAM_MESSAGE_MAX_LENGTH) ? (
        <span
          className={cn(
            "self-end text-xs",
            tooLong ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {draft.length} / {TEAM_MESSAGE_MAX_LENGTH}
        </span>
      ) : null}
    </div>
  );
}

function MessageList({
  scope,
  conversationId,
  conversation,
  thread,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly conversation: TeamConversation;
  readonly thread: ThreadState;
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
      className="scrollbar-gutter-both flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
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
          className="self-center"
          disabled={thread.loadingEarlier}
          onClick={() => void loadEarlier(scope, conversationId)}
        >
          {thread.loadingEarlier ? <Spinner className="size-4" /> : null}
          Load earlier messages
        </Button>
      ) : null}
      {thread.error !== null && thread.status === "ready" ? (
        <p role="alert" className="self-center text-xs text-destructive-foreground">
          {thread.error}
        </p>
      ) : null}
      {thread.messages.length === 0 && thread.pending.length === 0 ? (
        <p className="m-auto text-sm text-muted-foreground">
          Say hello to {conversation.peer.name}.
        </p>
      ) : null}
      {groups.map((group) => (
        <section
          key={group.key}
          aria-label={dayLabel(group.startedAt)}
          className="flex flex-col gap-2"
        >
          <h2 className="self-center text-xs font-medium text-muted-foreground">
            {dayLabel(group.startedAt)}
          </h2>
          {group.messages.map((message) => (
            <Bubble
              key={message.id}
              own={!isIncomingMessage(message, conversation)}
              time={formatShortTimestamp(message.createdAt, timestampFormat)}
            >
              {message.body}
            </Bubble>
          ))}
        </section>
      ))}
      {thread.pending.map((entry) => (
        <div key={entry.localId} className="flex flex-col items-end gap-0.5">
          <p
            className={cn(
              "max-w-[min(36rem,85%)] rounded-2xl bg-primary px-3 py-1.5 text-sm wrap-anywhere whitespace-pre-wrap text-primary-foreground",
              entry.status === "sending" ? "opacity-64" : "opacity-100",
            )}
          >
            {entry.body}
          </p>
          {entry.status === "sending" ? (
            <span className="px-1 text-3xs text-muted-foreground">Sending…</span>
          ) : (
            <span role="alert" className="flex items-center gap-2 px-1 text-xs">
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
          )}
        </div>
      ))}
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
  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to conversations"
          className="md:hidden"
          render={<Link to="/messages" />}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
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
          />
          <Composer
            scope={scope}
            conversationId={conversationId}
            sending={thread.pending.some((entry) => entry.status === "sending")}
          />
        </>
      )}
    </>
  );
}
