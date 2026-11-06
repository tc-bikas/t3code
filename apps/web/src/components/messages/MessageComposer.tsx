import { TEAM_MESSAGE_MAX_LENGTH } from "@t3tools/contracts";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  SquareCodeIcon,
  StrikethroughIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { cn, isMacPlatform } from "../../lib/utils";
import { editorJsonToMarkdown } from "../../team/messageMarkdown";
import { showsMessageCounter } from "../../team/messages.logic";
import { sendMessage, type MessagesScope } from "../../team/messagesStore";
import { ComposerSurface } from "../chat/ComposerSurface";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Only the Markdown the message renderer shows: no headings, rules, or images.
const EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    horizontalRule: false,
    underline: false,
    link: { openOnClick: false, autolink: false, defaultProtocol: "https" },
  }),
];

const EDITOR_CLASS = cn(
  "max-h-48 min-h-6 overflow-y-auto text-sm leading-6 wrap-anywhere outline-none",
  "[&_p+p]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_pre]:rounded-md [&_pre]:bg-muted/50 [&_pre]:px-2 [&_pre]:py-1 [&_pre]:font-mono [&_pre]:text-xs",
  "[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
);

function insideNode(state: EditorState, names: ReadonlyArray<string>): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    if (names.includes($from.node(depth).type.name)) return true;
  }
  return false;
}

const withProtocol = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;

function ToolbarToggle({
  label,
  shortcut,
  pressed,
  onPressedChange,
  children,
}: {
  readonly label: string;
  readonly shortcut: string;
  readonly pressed: boolean;
  readonly onPressedChange: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="xs"
            variant="ghost"
            aria-label={label}
            pressed={pressed}
            onPressedChange={onPressedChange}
            // Keep the editor's selection and focus while the button is pressed.
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>
        {label} <span className="text-muted-foreground">{shortcut}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

function FormattingToolbar({
  editor,
  linkOpen,
  linkHref,
  onLinkHrefChange,
  onLinkOpenChange,
}: {
  readonly editor: Editor;
  readonly linkOpen: boolean;
  readonly linkHref: string;
  readonly onLinkHrefChange: (href: string) => void;
  readonly onLinkOpenChange: (open: boolean) => void;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      bulletList: current.isActive("bulletList"),
      codeBlock: current.isActive("codeBlock"),
    }),
  });
  const mod = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl+";
  const alt = isMacPlatform(navigator.platform) ? "⌥" : "Alt+";
  const shift = isMacPlatform(navigator.platform) ? "⇧" : "Shift+";
  const chain = () => editor.chain().focus();

  const applyLink = () => {
    const href = linkHref.trim();
    onLinkOpenChange(false);
    if (href === "") {
      chain().extendMarkRange("link").unsetLink().run();
      return;
    }
    const url = withProtocol(href);
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href: url } }],
        })
        .run();
    } else {
      chain().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  return (
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
      <ToolbarToggle
        label="Bold"
        shortcut={`${mod}B`}
        pressed={active.bold}
        onPressedChange={() => chain().toggleBold().run()}
      >
        <BoldIcon />
      </ToolbarToggle>
      <ToolbarToggle
        label="Italic"
        shortcut={`${mod}I`}
        pressed={active.italic}
        onPressedChange={() => chain().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolbarToggle>
      <ToolbarToggle
        label="Strikethrough"
        shortcut={`${mod}${shift}S`}
        pressed={active.strike}
        onPressedChange={() => chain().toggleStrike().run()}
      >
        <StrikethroughIcon />
      </ToolbarToggle>
      <ToolbarToggle
        label="Code"
        shortcut={`${mod}E`}
        pressed={active.code}
        onPressedChange={() => chain().toggleCode().run()}
      >
        <CodeIcon />
      </ToolbarToggle>
      <Popover open={linkOpen} onOpenChange={onLinkOpenChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Toggle
                    size="xs"
                    variant="ghost"
                    aria-label="Link"
                    pressed={active.link}
                    onMouseDown={(event) => event.preventDefault()}
                  />
                }
              />
            }
          >
            <LinkIcon />
          </TooltipTrigger>
          <TooltipPopup>
            Link <span className="text-muted-foreground">{`${mod}K`}</span>
          </TooltipPopup>
        </Tooltip>
        <PopoverPopup side="top" align="start" width="sm" padding="compact">
          <form
            className="flex items-center gap-2 px-1"
            onSubmit={(event) => {
              event.preventDefault();
              applyLink();
            }}
          >
            <Input
              autoFocus
              size="sm"
              aria-label="Link address"
              placeholder="https://"
              value={linkHref}
              onChange={(event) => onLinkHrefChange(event.target.value)}
            />
            <Button type="submit" size="compact">
              {linkHref.trim() === "" && active.link ? "Remove" : "Apply"}
            </Button>
          </form>
        </PopoverPopup>
      </Popover>
      <ToolbarToggle
        label="Bulleted list"
        shortcut={`${mod}${shift}8`}
        pressed={active.bulletList}
        onPressedChange={() => chain().toggleBulletList().run()}
      >
        <ListIcon />
      </ToolbarToggle>
      <ToolbarToggle
        label="Code block"
        shortcut={`${mod}${alt}C`}
        pressed={active.codeBlock}
        onPressedChange={() => chain().toggleCodeBlock().run()}
      >
        <SquareCodeIcon />
      </ToolbarToggle>
    </div>
  );
}

export function MessageComposer({
  scope,
  conversationId,
  sending,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly sending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const tooLong = draft.length > TEAM_MESSAGE_MAX_LENGTH;
  const canSend = draft !== "" && !tooLong && !sending;

  const send = useStableCallback((target: Editor | null | undefined) => {
    if (!canSend) return;
    void sendMessage(scope, conversationId, draft);
    target?.chain().clearContent(true).focus().run();
  });
  const openLink = useStableCallback((open: boolean, target: Editor | null | undefined) => {
    if (open) setLinkHref(target?.getAttributes("link").href ?? "");
    setLinkOpen(open);
  });

  const editor = useEditor({
    extensions: EXTENSIONS,
    autofocus: "end",
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: EDITOR_CLASS, "aria-label": "Message" },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing) return false;
        const modifier = event.metaKey || event.ctrlKey;
        if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
          openLink(true, (view.dom as TiptapEditorHTMLElement).editor);
          return true;
        }
        if (event.key !== "Enter" || event.shiftKey || event.altKey) return false;
        // Enter continues lists and code blocks; Mod+Enter sends from anywhere.
        if (!modifier && insideNode(view.state, ["codeBlock", "listItem"])) return false;
        send((view.dom as TiptapEditorHTMLElement).editor);
        return true;
      },
    },
    onUpdate: ({ editor: updated }) => setDraft(editorJsonToMarkdown(updated.getJSON())),
  });
  const isEmpty = useEditorState({ editor, selector: ({ editor: current }) => current.isEmpty });

  return (
    <div className="flex flex-col gap-1 px-5 pt-1 pb-4">
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <div className="flex flex-col gap-1.5 rounded-2xl px-3 py-2.5">
              <div className="relative">
                {isEmpty ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 text-sm leading-6 text-placeholder"
                  >
                    Write a message
                  </span>
                ) : null}
                <EditorContent editor={editor} />
              </div>
              <div className="flex items-center justify-between gap-2">
                {editor ? (
                  <FormattingToolbar
                    editor={editor}
                    linkOpen={linkOpen}
                    linkHref={linkHref}
                    onLinkHrefChange={setLinkHref}
                    onLinkOpenChange={(open) => openLink(open, editor)}
                  />
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  aria-label={sending ? "Sending" : "Send message"}
                  disabled={!canSend}
                  onClick={() => send(editor)}
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
