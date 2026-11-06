import type { JSONContent } from "@tiptap/core";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const ALNUM = /[\p{L}\p{N}]/u;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g;
const PROTECTED_BASE = 0xe000;

/** Maps ASCII punctuation to private-use characters so later passes cannot read it as syntax. */
const protect = (text: string) =>
  text.replace(ASCII_PUNCTUATION, (char) =>
    String.fromCharCode(PROTECTED_BASE + char.charCodeAt(0)),
  );
const restore = (text: string) =>
  text.replace(/[-]/g, (char) => String.fromCharCode(char.charCodeAt(0) - PROTECTED_BASE));

function longestRun(text: string, char: string): number {
  let longest = 0;
  let run = 0;
  for (const current of text) {
    run = current === char ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Escapes characters Markdown would read as formatting; URLs stay intact so they still link. */
function escapeText(text: string): string {
  const escape = (segment: string, before: string | undefined) =>
    segment.replace(/[\\`*[\]~_]/g, (char, offset: number) => {
      if (char !== "_") return `\\${char}`;
      const previous = offset === 0 ? before : segment[offset - 1];
      const next = segment[offset + 1];
      const intraword =
        previous !== undefined && next !== undefined && ALNUM.test(previous) && ALNUM.test(next);
      return intraword ? char : "\\_";
    });
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    out += escape(text.slice(cursor, match.index), text[cursor - 1]);
    out += match[0];
    cursor = match.index + match[0].length;
  }
  return out + escape(text.slice(cursor), text[cursor - 1]);
}

function escapeLineStarts(paragraph: string): string {
  return paragraph
    .replace(/^([ \t]*)([#>+])(?=[ \t]|$)/gm, "$1\\$2")
    .replace(/^([ \t]*)-(?=[ \t-]|$)/gm, "$1\\-")
    .replace(/^([ \t]*\d+)([.)])(?=[ \t]|$)/gm, "$1\\$2");
}

type Mark = NonNullable<JSONContent["marks"]>[number];

function markedText(text: string, marks: ReadonlyArray<Mark>): string {
  const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
  if (core === "") return text;
  const has = (type: string) => marks.some((mark) => mark.type === type);
  let body: string;
  if (has("code")) {
    const fence = "`".repeat(longestRun(core, "`") + 1);
    body =
      core.startsWith("`") || core.endsWith("`")
        ? `${fence} ${core} ${fence}`
        : `${fence}${core}${fence}`;
  } else {
    body = escapeText(core);
    if (has("italic")) body = `*${body}*`;
    if (has("bold")) body = `**${body}**`;
    if (has("strike")) body = `~~${body}~~`;
    const href = marks.find((mark) => mark.type === "link")?.attrs?.href;
    if (typeof href === "string") {
      body = `[${body}](${href.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`;
    }
  }
  return `${lead}${body}${trail}`;
}

function inlineContent(nodes: ReadonlyArray<JSONContent> | undefined): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") out += "\n";
    else if (node.type === "text") out += markedText(node.text ?? "", node.marks ?? []);
  }
  return out;
}

function indent(text: string, first: string): string {
  const rest = " ".repeat(first.length);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? `${first}${line}` : line === "" ? line : `${rest}${line}`))
    .join("\n");
}

function blocks(nodes: ReadonlyArray<JSONContent> | undefined, tight = false): string {
  let out = "";
  for (const node of nodes ?? []) {
    const text = block(node);
    if (text === "") continue;
    const nested = node.type === "bulletList" || node.type === "orderedList";
    out += out === "" ? text : `${tight && nested ? "\n" : "\n\n"}${text}`;
  }
  return out;
}

function block(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return escapeLineStarts(inlineContent(node.content)).trim();
    case "codeBlock": {
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      const fence = "`".repeat(Math.max(3, longestRun(code, "`") + 1));
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case "blockquote":
      return blocks(node.content)
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "bulletList":
      return (node.content ?? [])
        .map((item) => indent(blocks(item.content, true), "- "))
        .join("\n");
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return (node.content ?? [])
        .map((item, index) => indent(blocks(item.content, true), `${start + index}. `))
        .join("\n");
    }
    default:
      return "";
  }
}

/** Serializes the message editor's document to the Markdown that goes over the wire. */
export function editorJsonToMarkdown(doc: JSONContent): string {
  return blocks(doc.content).trim();
}

/** One readable line for notifications: Markdown syntax removed, line breaks become spaces. */
export function markdownToPlainText(markdown: string): string {
  const lines = markdown
    .replace(/\\([!-/:-@[-`{-~])/g, (_, char: string) => protect(char))
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:`{3,}|~{3,}).*$/, "")
        .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/, "")
        .replace(/^\s{0,3}(?:>\s?)+/, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ""),
    );
  return restore(
    lines
      .join(" ")
      .replace(/`+([^`]+)`+/g, (_, code: string) => protect(code.trim()))
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(?!\s)(.+?)(?<!\s)\1/g, "$2")
      .replace(/~~(?!\s)(.+?)(?<!\s)~~/g, "$1")
      .replace(/\*(?!\s)(.+?)(?<!\s)\*/g, "$1")
      .replace(/(?<![\p{L}\p{N}])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}])/gu, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}
