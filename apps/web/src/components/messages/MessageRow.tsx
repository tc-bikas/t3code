import type { TeamMessage } from "@t3tools/contracts";
import { memo, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { isOwnLiveMessage, replySnippet } from "../../team/messages.logic";
import { TeamAvatar } from "../../team/TeamAvatar";
import { MessageActions } from "./MessageActions";
import { MessageMarkdown } from "./MessageMarkdown";
import { MessageReactions } from "./MessageReactions";

/** The original a reply quotes; selecting it jumps there unless the original is gone. */
export function ReplyQuote({
  name,
  original,
  onJump,
}: {
  readonly name: string;
  readonly original: { readonly body: string; readonly deleted: boolean };
  readonly onJump?: (() => void) | undefined;
}) {
  const content = (
    <>
      {original.deleted ? null : <span className="shrink-0 font-medium">{name}</span>}
      <span className={cn("truncate", original.deleted && "italic")}>{replySnippet(original)}</span>
    </>
  );
  const className =
    "mb-0.5 flex min-w-0 max-w-full items-center gap-1.5 self-start border-l-2 border-border pl-2 text-left text-xs text-muted-foreground";
  return original.deleted || onJump === undefined ? (
    <div className={className}>{content}</div>
  ) : (
    <button
      type="button"
      aria-label={`Go to the message from ${name}`}
      onClick={onJump}
      className={cn(className, "cursor-pointer hover:text-foreground")}
    >
      {content}
    </button>
  );
}

/** Slack-style row: everyone's messages sit left, the name and avatar open each run. */
export function MessageRow({
  authorName,
  authorAvatarUrl,
  startsRun,
  gapBefore,
  time,
  edited = false,
  dimmed = false,
  messageId,
  quote,
  bar,
  onEngage,
  children,
  footer,
}: {
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly startsRun: boolean;
  /** Space above a run that follows other messages; grouped messages sit closer. */
  readonly gapBefore: boolean;
  readonly time: string;
  readonly edited?: boolean;
  readonly dimmed?: boolean;
  /** Set on rows a reply can jump to. */
  readonly messageId?: string;
  readonly quote?: ReactNode;
  readonly bar?: ReactNode;
  /** Called when the pointer or focus first reaches the row. */
  readonly onEngage?: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const editedLabel = edited ? (
    <span className="text-3xs text-muted-foreground">(edited)</span>
  ) : null;
  return (
    <div
      data-message-id={messageId}
      tabIndex={onEngage === undefined ? undefined : 0}
      onPointerEnter={onEngage}
      onFocus={onEngage}
      className={cn(
        "group/message relative mx-2 flex gap-3 rounded-lg px-3 py-0.5 transition-colors duration-700 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none data-[highlight=true]:bg-accent motion-reduce:transition-none",
        startsRun && "pt-1",
        startsRun && gapBefore && "mt-4",
      )}
    >
      {bar}
      <div className="w-10 shrink-0 self-start">
        {startsRun ? (
          <TeamAvatar name={authorName} avatarUrl={authorAvatarUrl} />
        ) : (
          <span className="hidden pt-1.5 text-right text-3xs text-muted-foreground tabular-nums group-focus-within/message:block group-hover/message:block">
            {time}
          </span>
        )}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col", dimmed && "opacity-64")}>
        {startsRun ? (
          <div className="flex items-baseline gap-2 leading-6">
            <span className="truncate text-sm font-semibold">{authorName}</span>
            <span className="text-xs text-muted-foreground">{time}</span>
            {editedLabel}
          </div>
        ) : null}
        {quote}
        {children}
        {startsRun ? null : editedLabel}
        {footer}
      </div>
    </div>
  );
}

export interface ThreadRowHandlers {
  readonly onReact: (message: TeamMessage, anchor: HTMLElement) => void;
  readonly onToggleReaction: (message: TeamMessage, emoji: string) => void;
  readonly onReply: (message: TeamMessage) => void;
  readonly onEdit: (message: TeamMessage) => void;
  readonly onDelete: (message: TeamMessage) => void;
  readonly onJump: (messageId: string) => void;
}

/**
 * A stored message. Props are primitives and stable callbacks so a reaction or edit re-renders
 * only the row it changed. The action bar mounts once the row has been hovered or focused.
 */
export const ThreadMessageRow = memo(function ThreadMessageRow({
  message,
  authorName,
  authorAvatarUrl,
  startsRun,
  gapBefore,
  time,
  selfId,
  selfName,
  peerId,
  peerName,
  pickerOpen,
  onReact,
  onToggleReaction,
  onReply,
  onEdit,
  onDelete,
  onJump,
}: ThreadRowHandlers & {
  readonly message: TeamMessage;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly startsRun: boolean;
  readonly gapBefore: boolean;
  readonly time: string;
  readonly selfId: string;
  readonly selfName: string;
  readonly peerId: string;
  readonly peerName: string;
  readonly pickerOpen: boolean;
}) {
  const [engaged, setEngaged] = useState(false);
  if (message.deleted) {
    return (
      <MessageRow
        authorName={authorName}
        authorAvatarUrl={authorAvatarUrl}
        startsRun={startsRun}
        gapBefore={gapBefore}
        time={time}
        messageId={message.id}
      >
        <p className="text-sm leading-relaxed text-muted-foreground italic">
          This message was deleted
        </p>
      </MessageRow>
    );
  }
  const reply = message.replyTo;
  return (
    <MessageRow
      authorName={authorName}
      authorAvatarUrl={authorAvatarUrl}
      startsRun={startsRun}
      gapBefore={gapBefore}
      time={time}
      edited={message.editedAt !== null}
      messageId={message.id}
      onEngage={() => setEngaged(true)}
      bar={
        engaged || pickerOpen ? (
          <MessageActions
            message={message}
            own={isOwnLiveMessage(message, selfId)}
            pickerOpen={pickerOpen}
            onReact={onReact}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : null
      }
      quote={
        reply === null ? null : (
          <ReplyQuote
            name={reply.senderId === selfId ? selfName : peerName}
            original={reply}
            onJump={() => onJump(reply.id)}
          />
        )
      }
      footer={
        message.reactions.length === 0 ? null : (
          <MessageReactions
            reactions={message.reactions}
            selfId={selfId}
            names={{ [selfId]: selfName, [peerId]: peerName }}
            onToggle={(emoji) => onToggleReaction(message, emoji)}
            onAdd={(anchor) => onReact(message, anchor)}
          />
        )
      }
    >
      <MessageMarkdown body={message.body} />
    </MessageRow>
  );
});
