import { useLocation, useNavigate } from "@tanstack/react-router";
import { MessageCirclePlusIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { openConversationId, unreadLabel } from "../../team/messages.logic";
import { TeamAvatar } from "../../team/TeamAvatar";
import { useTeamMessages, useTeamUnread } from "../../team/useTeamMessages";
import { NewMessageDialog } from "../messages/NewMessageDialog";
import { Badge } from "../ui/badge";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

const MESSAGES_SHELF_EXPANDED_KEY = "t3code:sidebar:messages-expanded";

/** A shelf above Settled: one row per person you have talked to, by name, with an unread count. */
export function SidebarMessagesShelf(props: { className?: string }) {
  const [expanded, setExpanded] = useLocalStorage(
    MESSAGES_SHELF_EXPANDED_KEY,
    true,
    Schema.Boolean,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();
  const { state } = useTeamMessages();
  const unread = useTeamUnread();
  const activeId = useLocation({ select: (location) => openConversationId(location.pathname) });
  return (
    <>
      <li className={cn("relative mx-0.5 h-8 list-none", props.className)}>
        <CollapsibleSectionHeader
          data-sidebar-row="shelf:messages"
          data-testid="sidebar-messages-shelf-toggle"
          expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          accessory={
            unread > 0 ? (
              <Badge size="sm" aria-label={`${unread} unread`}>
                {unreadLabel(unread)}
              </Badge>
            ) : (
              <span className="font-normal tabular-nums">{state.conversations.length}</span>
            )
          }
        >
          Direct messages
        </CollapsibleSectionHeader>
      </li>
      {expanded ? (
        <>
          {state.conversations.map((conversation) => (
            <li className="list-none" key={conversation.id}>
              <button
                type="button"
                data-sidebar-row={`message:${conversation.id}`}
                aria-current={conversation.id === activeId ? "page" : undefined}
                onClick={() =>
                  void navigate({
                    to: "/messages/$conversationId",
                    params: { conversationId: conversation.id },
                  })
                }
                className={cn(
                  "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                  conversation.id === activeId
                    ? "bg-sidebar-row-hover text-sidebar-foreground"
                    : "text-sidebar-muted-foreground",
                  conversation.unreadCount > 0 && "font-semibold text-sidebar-foreground",
                )}
              >
                <TeamAvatar
                  name={conversation.peer.name}
                  avatarUrl={conversation.peer.avatarUrl}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate">{conversation.peer.name}</span>
                {conversation.unreadCount > 0 ? (
                  <Badge size="sm" aria-label={`${conversation.unreadCount} unread`}>
                    {unreadLabel(conversation.unreadCount)}
                  </Badge>
                ) : null}
              </button>
            </li>
          ))}
          <li className="list-none">
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            >
              <MessageCirclePlusIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">New message</span>
            </button>
          </li>
        </>
      ) : null}
      <NewMessageDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
