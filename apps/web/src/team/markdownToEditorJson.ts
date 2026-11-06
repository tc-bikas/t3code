import type { JSONContent } from "@tiptap/core";
import type { Nodes, PhrasingContent, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

type Mark = NonNullable<JSONContent["marks"]>[number];

function plain(node: Nodes): string {
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map((child) => plain(child)).join("");
  return "alt" in node ? (node.alt ?? "") : "";
}

function textNodes(text: string, marks: ReadonlyArray<Mark>): JSONContent[] {
  const out: JSONContent[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) out.push({ type: "hardBreak" });
    if (line !== "")
      out.push({ type: "text", text: line, ...(marks.length ? { marks: [...marks] } : {}) });
  });
  return out;
}

function inline(
  nodes: ReadonlyArray<PhrasingContent>,
  marks: ReadonlyArray<Mark>,
  source: string,
): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    switch (node.type) {
      case "text":
        return textNodes(node.value, marks);
      case "strong":
        return inline(node.children, [...marks, { type: "bold" }], source);
      case "emphasis":
        return inline(node.children, [...marks, { type: "italic" }], source);
      case "delete":
        return inline(node.children, [...marks, { type: "strike" }], source);
      // Code excludes every other mark in the editor.
      case "inlineCode":
        return textNodes(node.value, [{ type: "code" }]);
      case "break":
        return [{ type: "hardBreak" }];
      case "link": {
        // gfm turns bare URLs into links; the editor keeps them as text, as the serializer writes.
        const explicit = source[node.position?.start.offset ?? -1] === "[";
        return inline(
          node.children,
          explicit ? [...marks, { type: "link", attrs: { href: node.url } }] : marks,
          source,
        );
      }
      default:
        return textNodes(plain(node), marks);
    }
  });
}

function withContent(node: JSONContent, content: JSONContent[]): JSONContent {
  return content.length > 0 ? { ...node, content } : node;
}

function blocks(nodes: ReadonlyArray<RootContent>, source: string): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    switch (node.type) {
      case "paragraph":
      case "heading":
        return [withContent({ type: "paragraph" }, inline(node.children, [], source))];
      case "code":
        return [
          withContent(
            { type: "codeBlock", attrs: { language: node.lang ?? null } },
            node.value === "" ? [] : [{ type: "text", text: node.value }],
          ),
        ];
      case "blockquote": {
        const content = blocks(node.children, source);
        return [
          { type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] },
        ];
      }
      case "list":
        return [
          {
            type: node.ordered ? "orderedList" : "bulletList",
            ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
            content: node.children.map((item) => {
              const content = blocks(item.children, source);
              return {
                type: "listItem",
                content: content.length ? content : [{ type: "paragraph" }],
              };
            }),
          },
        ];
      case "thematicBreak":
        return [];
      default:
        return [withContent({ type: "paragraph" }, textNodes(plain(node), []))];
    }
  });
}

/**
 * The editor document for a message's Markdown: the reverse of `editorJsonToMarkdown`.
 * It reads what the serializer writes (paragraphs, hard breaks, bold, italic, strike, code,
 * links, lists, quotes, fences). Anything else, such as a heading, arrives as plain paragraphs, and
 * a literal HTML entity such as `&amp;` in a message is read as the character it names.
 */
export function markdownToEditorJson(markdown: string): JSONContent {
  const root = parser.parse(markdown);
  const content = blocks(root.children, markdown);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
