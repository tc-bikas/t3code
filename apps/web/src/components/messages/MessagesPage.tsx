import type { TeamConversation } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessageCirclePlusIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { previewText, unreadLabel } from "../../team/messages.logic";
import { loadConversations } from "../../team/messagesStore";
import { TeamAvatar } from "../../team/TeamAvatar";
import { useTeamMessages } from "../../team/useTeamMessages";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ConversationView } from "./ConversationView";
import { NewMessageDialog } from "./NewMessageDialog";

function ConversationRow({
  conversation,
  active,
}: {
  readonly conversation: TeamConversation;
  readonly active: boolean;
}) {
  const { peer, lastMessage, unreadCount } = conversation;
  const unread = unreadCount > 0;
  return (
    <Link
      to="/messages/$conversationId"
      params={{ conversationId: conversation.id }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 outline-hidden ring-ring hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset",
        active && "bg-accent",
      )}
    >
      <TeamAvatar name={peer.name} avatarUrl={peer.avatarUrl} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {peer.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">@{peer.githubLogin}</span>
          {lastMessage === null ? null : (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatRelativeTimeLabel(lastMessage.createdAt)}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {lastMessage === null ? "No messages yet" : previewText(lastMessage.body)}
          </span>
          {unread ? (
            <Badge size="sm" aria-label={`${unreadCount} unread`}>
              {unreadLabel(unreadCount)}
            </Badge>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function SignedOutState() {
  const navigate = useNavigate();
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Sign in to send messages</EmptyTitle>
        <EmptyDescription>Direct messages use your T3 account.</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" onClick={() => void navigate({ to: "/settings/account" })}>
        Open account settings
      </Button>
    </Empty>
  );
}

export function MessagesPage({ conversationId }: { readonly conversationId: string | null }) {
  const { scope, state } = useTeamMessages();
  const [dialogOpen, setDialogOpen] = useState(false);
  const active = state.conversations.find((entry) => entry.id === conversationId);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Messages</h1>
          <div className="min-w-0 flex-1" />
          {scope === null ? null : (
            <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
              <MessageCirclePlusIcon aria-hidden="true" />
              New message
            </Button>
          )}
        </WorkspacePageHeader>

        {scope === null ? (
          <SignedOutState />
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav
              aria-label="Conversations"
              className={cn(
                "flex w-full min-w-0 shrink-0 flex-col border-r border-border md:w-80",
                conversationId !== null && "max-md:hidden",
              )}
            >
              {state.listStatus === "loading" ? (
                <div className="flex flex-1 items-center justify-center">
                  <Spinner className="size-4" />
                </div>
              ) : state.listStatus === "failed" ? (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <EmptyTitle>Couldn't load conversations</EmptyTitle>
                    <EmptyDescription>{state.listError}</EmptyDescription>
                  </EmptyHeader>
                  <Button size="sm" onClick={() => void loadConversations(scope)}>
                    Try again
                  </Button>
                </Empty>
              ) : state.conversations.length === 0 ? (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <EmptyTitle>No conversations yet</EmptyTitle>
                    <EmptyDescription>Start one with anyone who uses T3 Code.</EmptyDescription>
                  </EmptyHeader>
                  <Button size="sm" onClick={() => setDialogOpen(true)}>
                    New message
                  </Button>
                </Empty>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
                  {state.conversations.map((conversation) => (
                    <li key={conversation.id}>
                      <ConversationRow
                        conversation={conversation}
                        active={conversation.id === conversationId}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </nav>

            <section
              aria-label="Conversation"
              className={cn(
                "flex min-w-0 flex-1 flex-col",
                conversationId === null && "max-md:hidden",
              )}
            >
              {conversationId === null ? (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <MessageSquareIcon aria-hidden="true" className="mb-3 size-6 text-icon-muted" />
                    <EmptyTitle>Select a conversation</EmptyTitle>
                    <EmptyDescription>
                      Pick one from the list, or start a new message.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ConversationView
                  key={conversationId}
                  scope={scope}
                  conversationId={conversationId}
                  conversation={active}
                  thread={state.threads[conversationId]}
                  listReady={state.listStatus === "ready"}
                />
              )}
            </section>
          </div>
        )}
      </div>
      {scope === null ? null : <NewMessageDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </SidebarInset>
  );
}
