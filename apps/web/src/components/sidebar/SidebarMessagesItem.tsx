import { MessageCircleIcon } from "lucide-react";

import { unreadLabel } from "../../team/messages.logic";
import { useTeamAccount } from "../../team/useTeam";
import { useTeamUnread } from "../../team/useTeamMessages";
import { Badge } from "../ui/badge";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Only signed-in people have messages, so a signed-out sidebar shows nothing here. */
export function SidebarMessagesItem({ onOpen }: { readonly onOpen: () => void }) {
  const { token } = useTeamAccount();
  const unread = useTeamUnread();
  if (token === null) return null;
  const label = unread > 0 ? `Messages (${unread} unread)` : "Messages";
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onOpen} size="icon">
              <MessageCircleIcon />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      {unread > 0 ? (
        <span className="pointer-events-none absolute -top-1 -right-1">
          <Badge size="sm">{unreadLabel(unread)}</Badge>
        </span>
      ) : null}
    </SidebarMenuItem>
  );
}
