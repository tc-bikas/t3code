import type { TeamReaction } from "@t3tools/contracts";
import { SmilePlusIcon } from "lucide-react";

import { reactionWho } from "../../team/messages.logic";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** One pill per emoji, lit when you reacted; a pill toggles your reaction. */
export function MessageReactions({
  reactions,
  selfId,
  names,
  onToggle,
  onAdd,
}: {
  readonly reactions: ReadonlyArray<TeamReaction>;
  readonly selfId: string;
  readonly names: Readonly<Record<string, string>>;
  readonly onToggle: (emoji: string) => void;
  readonly onAdd: (anchor: HTMLElement) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(selfId);
        const who = reactionWho(reaction.userIds, selfId, names);
        return (
          <Tooltip key={reaction.emoji}>
            <TooltipTrigger
              render={
                <Toggle
                  size="xs"
                  variant="outline"
                  pressed={mine}
                  aria-label={`${reaction.emoji} ${who}`}
                  onPressedChange={() => onToggle(reaction.emoji)}
                />
              }
            >
              <span className="leading-none">{reaction.emoji}</span>
              <span className="text-xs tabular-nums">{reaction.userIds.length}</span>
            </TooltipTrigger>
            <TooltipPopup>{who}</TooltipPopup>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Add reaction"
              onClick={(event) => onAdd(event.currentTarget)}
            />
          }
        >
          <SmilePlusIcon />
        </TooltipTrigger>
        <TooltipPopup>Add reaction</TooltipPopup>
      </Tooltip>
    </div>
  );
}
