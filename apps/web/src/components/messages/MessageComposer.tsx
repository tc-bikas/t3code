import { TEAM_MESSAGE_MAX_LENGTH, type TeamMessage } from "@t3tools/contracts";
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
  PencilIcon,
  ReplyIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { cn, isMacPlatform } from "../../lib/utils";
import { markdownToEditorJson } from "../../team/markdownToEditorJson";
import { editorJsonToMarkdown } from "../../team/messageMarkdown";
import { replySnippet, showsMessageCounter } from "../../team/messages.logic";
import { editMessage, sendMessage, type MessagesScope } from "../../team/messagesStore";
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

/** What the composer is doing besides writing a new message. `serial` changes on every request. */
export interface ComposerMode {
  readonly kind: "reply" | "edit";
  readonly message: TeamMessage;
  /** Who the reply goes to, for the strip above the editor. */
  readonly authorName: string;
  readonly serial: number;
}

function ModeStrip({
  mode,
  error,
  onCancel,
}: {
  readonly mode: ComposerMode;
  readonly error: string | null;
  readonly onCancel: () => void;
}) {
  const editing = mode.kind === "edit";
  const Icon = editing ? PencilIcon : ReplyIcon;
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 pb-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {editing ? (
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">Editing message</span>
            <span> · Enter to save, Esc to cancel</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            Replying to <span className="font-medium text-foreground">{mode.authorName}</span>
            <span> · {replySnippet(mode.message)}</span>
          </span>
        )}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label={editing ? "Cancel editing" : "Cancel reply"}
          onClick={onCancel}
        >
          <XIcon />
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

export function MessageComposer({
  scope,
  conversationId,
  sending,
  mode,
  onModeDone,
}: {
  readonly scope: MessagesScope;
  readonly conversationId: string;
  readonly sending: boolean;
  readonly mode: ComposerMode | null;
  readonly onModeDone: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const editing = mode?.kind === "edit";
  const busy = editing ? save.busy : sending;
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const tooLong = draft.length > TEAM_MESSAGE_MAX_LENGTH;
  const canSend = draft !== "" && !tooLong && !busy;

  const send = useStableCallback(async (target: Editor | null | undefined) => {
    if (!canSend) return;
    if (mode?.kind === "edit") {
      if (draft === mode.message.body) {
        onModeDone();
        return;
      }
      setSave({ busy: true, error: null });
      const error = await editMessage(scope, conversationId, mode.message.id, draft);
      setSave({ busy: false, error });
      if (error === null) onModeDone();
      return;
    }
    void sendMessage(scope, conversationId, draft, mode?.kind === "reply" ? mode.message.id : null);
    target?.chain().clearContent(true).focus().run();
    if (mode !== null) onModeDone();
  });
  // Escape leaves a reply or an edit whenever the editor has focus; the draft stays as it was.
  const dismissMode = useStableCallback(() => {
    if (mode === null) return false;
    setSave({ busy: false, error: null });
    onModeDone();
    return true;
  });
  const modeBody = useStableCallback(() => (mode?.kind === "edit" ? mode.message.body : ""));
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
        if (event.key === "Escape") return dismissMode();
        const modifier = event.metaKey || event.ctrlKey;
        if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
          openLink(true, (view.dom as TiptapEditorHTMLElement).editor);
          return true;
        }
        if (event.key !== "Enter" || event.shiftKey || event.altKey) return false;
        // Enter continues lists and code blocks; Mod+Enter sends from anywhere.
        if (!modifier && insideNode(view.state, ["codeBlock", "listItem"])) return false;
        void send((view.dom as TiptapEditorHTMLElement).editor);
        return true;
      },
    },
    onUpdate: ({ editor: updated }) => setDraft(editorJsonToMarkdown(updated.getJSON())),
  });
  const isEmpty = useEditorState({ editor, selector: ({ editor: current }) => current.isEmpty });
  const modeSerial = mode?.serial;
  const editSerial = editing ? modeSerial : undefined;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the message being edited into the external editor, and puts the unsent draft back when the edit ends
  useEffect(() => {
    if (editor === null || editSerial === undefined) return;
    const stash = editor.getJSON();
    editor.commands.setContent(markdownToEditorJson(modeBody()), { emitUpdate: true });
    editor.commands.focus("end");
    return () => {
      if (!editor.isDestroyed) editor.commands.setContent(stash, { emitUpdate: true });
    };
  }, [editor, editSerial, modeBody]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves browser focus into the editor when a reply starts
  useEffect(() => {
    if (editor !== null && modeSerial !== undefined) editor.commands.focus("end");
  }, [editor, modeSerial]);

  return (
    <div className="flex flex-col gap-1 px-5 pt-1 pb-4">
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <div className="flex flex-col gap-1.5 rounded-2xl px-3 py-2.5">
              {mode === null ? null : (
                <ModeStrip
                  mode={mode}
                  error={editing ? save.error : null}
                  onCancel={() => dismissMode()}
                />
              )}
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
                  aria-label={busy ? "Sending" : editing ? "Save changes" : "Send message"}
                  disabled={!canSend}
                  onClick={() => void send(editor)}
                  className="relative isolate flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:shadow-message-action/24 enabled:inset-shadow-control-highlight hover:bg-message-action-hover enabled:hover:scale-105 active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none [&_svg]:pointer-events-none"
                >
                  {busy ? (
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
