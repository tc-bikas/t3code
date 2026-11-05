import { ArrowRightIcon, CornerDownLeftIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { TrellisIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandListHeading,
  CommandShortcut,
} from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";

/**
 * A + before the send button. Its menu opens an issue search; Trellis is not connectable yet, so
 * the list only offers its setup step.
 */
export function ComposerLinkIssueMenu(props: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  return (
    <>
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                disabled={props.disabled}
                render={
                  <Button variant="ghost-muted" size="icon-sm" aria-label="Link issues">
                    <PlusIcon aria-hidden="true" />
                  </Button>
                }
              />
            }
          />
          <TooltipPopup>Link issues</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
          <MenuItem onClick={() => setOpen(true)}>
            <TrellisIcon className="size-4" />
            Link issue
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={open} onOpenChange={close}>
        <DialogPopup className="max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Link issues</DialogTitle>
          <Command mode="none" value={query} onValueChange={setQuery} aria-label="Link issues">
            <CommandInput placeholder="Search issues…" />
            <CommandList>
              <CommandListHeading>Setup</CommandListHeading>
              <CommandItem
                value="connect-trellis"
                onClick={() => {
                  close(false);
                  toastManager.add({
                    type: "info",
                    title: "Trellis isn't available yet",
                    description: "Linking issues is coming soon.",
                  });
                }}
              >
                <TrellisIcon className="size-5 shrink-0" />
                <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-icon-muted" />
                <span className="min-w-0 flex-1 truncate">Connect Trellis</span>
                <CommandShortcut>
                  <span className="flex items-center gap-1.5">
                    Setup
                    <CornerDownLeftIcon aria-hidden="true" className="size-3.5" />
                  </span>
                </CommandShortcut>
              </CommandItem>
            </CommandList>
          </Command>
        </DialogPopup>
      </Dialog>
    </>
  );
}
