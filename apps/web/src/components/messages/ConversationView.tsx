import { TEAM_MESSAGE_MAX_LENGTH, type TeamConversation } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  dayLabel,
  groupMessagesByDay,
  MAX_MESSAGES_PER_CONVERSATION,
  showsMessageCounter,
  splitMessageText,
  startsMessageRun,
  type MessageSegment,
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
import { useTeamAccount } from "../../team/useTeam";
import { ensureLocalApi } from "../../localApi";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ComposerSurface } from "../chat/ComposerSurface";
import { Spinner } from "../ui/spinner";

const NEAR_BOTTOM_PX = 96;

const openLink = (url: string) => {
  void ensureLocalApi().shell.openExternal(url);
};

function MessageText({ body }: { readonly body: string }) {
  const keyed: Array<{ key: number; segment: MessageSegment }> = [];
  let offset = 0;
  for (const segment of splitMessageText(body)) {
    keyed.push({ key: offset, segment });
    offset += segment.kind === "text" ? segment.text.length : segment.url.length;
  }
  const parts = keyed.map(({ key, segment }) => {
    if (segment.kind === "text") return <span key={key}>{segment.text}</span>;
    const common = {
      href: segment.url,
      target: "_blank",
      rel: "noreferrer noopener",
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        openLink(segment.url);
      },
    } as const;
    return segment.kind === "link" ? (
      <a
        key={key}
        {...common}
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {segment.url}
      </a>
    ) : (
      <a
        key={key}
        {...common}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 align-middle text-xs text-foreground no-underline hover:bg-accent"
      >
        <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {segment.repository} #{segment.number}
        </span>
      </a>
    );
  });
  return (
    <p className="min-w-0 text-sm wrap-anywhere whitespace-pre-wrap text-foreground">{parts}</p>
  );
}

/** Slack-style row: everyone's messages sit left, the name and avatar open each run. */
function MessageRow({
  author,
  startsRun,
  time,
  dimmed = false,
  children,
  footer,
}: {
  readonly author: { readonly name: string; readonly avatarUrl: string | null };
  readonly startsRun: boolean;
  readonly time: string;
  readonly dimmed?: boolean;
  readonly children: string;
  readonly footer?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/message flex gap-3 px-4 py-0.5 hover:bg-accent/40",
        startsRun && "mt-2 pt-1",
      )}
    >
      <div className="w-10 shrink-0">
        {startsRun ? (
          <TeamAvatar name={author.name} avatarUrl={author.avatarUrl} />
        ) : (
          <span className="hidden pt-1 text-right text-3xs text-muted-foreground tabular-nums group-hover/message:block">
            {time}
          </span>
        )}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col", dimmed && "opacity-64")}>
        {startsRun ? (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{author.name}</span>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
        ) : null}
        <MessageText body={children} />
        {footer}
      </div>
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
    <div className="flex flex-col gap-1 px-4 pt-1 pb-4">
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <div className="flex items-end gap-2 rounded-2xl px-3 py-2.5">
              <textarea
                aria-label="Message"
                placeholder="Write a message"
                rows={1}
                value={draft}
                aria-invalid={tooLong || undefined}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                className="max-h-48 min-h-6 min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 [field-sizing:content] outline-none placeholder:text-placeholder"
              />
              <button
                type="button"
                aria-label={sending ? "Sending" : "Send message"}
                disabled={!canSend}
                onClick={send}
                className="relative isolate flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:shadow-message-action/24 enabled:inset-shadow-control-highlight hover:bg-message-action-hover enabled:hover:scale-105 active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none [&_svg]:pointer-events-none"
              >
                {sending ? (
                  <Spinner size="sm" aria-hidden="true" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 3L8 13M8 3L4 7M8 3L12 7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          </ComposerSurface.Main>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
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
      className="scrollbar-gutter-both flex min-h-0 flex-1 flex-col overflow-y-auto py-3"
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
        <section key={group.key} aria-label={dayLabel(group.startedAt)} className="flex flex-col">
          <h2 className="relative my-3 flex items-center px-4 text-xs font-medium text-foreground">
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
