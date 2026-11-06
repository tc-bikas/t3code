import type { TeamMessage } from "@t3tools/contracts";
import { EllipsisIcon, PencilIcon, ReplyIcon, SmilePlusIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function ActionButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: (anchor: HTMLElement) => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={label}
            onClick={(event) => onClick(event.currentTarget)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The floating bar at a row's top right. It stays in the tab order but invisible until the row is
 * hovered or holds focus, and stays shown while its menu or the shared emoji picker is open.
 */
export function MessageActions({
  message,
  own,
  pickerOpen,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: {
  readonly message: TeamMessage;
  readonly own: boolean;
  readonly pickerOpen: boolean;
  readonly onReact: (message: TeamMessage, anchor: HTMLElement) => void;
  readonly onReply: (message: TeamMessage) => void;
  readonly onEdit: (message: TeamMessage) => void;
  readonly onDelete: (message: TeamMessage) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cn(
        "absolute -top-3 right-3 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 text-popover-foreground opacity-0 shadow-sm transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none",
        (menuOpen || pickerOpen) && "opacity-100",
      )}
    >
      <ActionButton label="Add reaction" onClick={(anchor) => onReact(message, anchor)}>
        <SmilePlusIcon />
      </ActionButton>
      <ActionButton label="Reply" onClick={() => onReply(message)}>
        <ReplyIcon />
      </ActionButton>
      {own ? (
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="More actions"
                    />
                  }
                />
              }
            >
              <EllipsisIcon />
            </TooltipTrigger>
            <TooltipPopup>More</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuItem onClick={() => onEdit(message)}>
              <PencilIcon />
              Edit message
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => onDelete(message)}>
              <Trash2Icon />
              Delete message
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}
