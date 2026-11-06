import { describe, expect, it } from "vite-plus/test";

import { editorJsonToMarkdown } from "./messageMarkdown";
import { markdownToEditorJson } from "./markdownToEditorJson";

describe("markdownToEditorJson", () => {
  // Each is Markdown the serializer writes, so loading it for an edit must give it back unchanged.
  it.each([
    "hello",
    "one\n\ntwo",
    "line one\nline two",
    "**bold** *italic* ~~strike~~ `code` plain",
    "***both***",
    "see [the docs](https://example.test/a%20b) now",
    "bare https://example.test/path link",
    "\\*not italic\\* \\_x\\_ \\[x\\] \\`tick\\` 2 \\* 3",
    "\\# not a heading\n\n1\\. not a list",
    "snake_case_name and 2 \\* 3 \\* 4",
    "- a\n- b\n  - nested\n- c",
    "- a\n  1. b\n- c",
    "3. three\n4. four",
    "> quoted\n>\n> second **line**",
    "```ts\nconst a = 1;\n\nlet b;\n```",
    "````\na ```\nb\n````",
    "before\n\n```\ncode\n```\n\nafter",
    "``a`b``",
    "tab\\\\slash",
    "emoji 🎉 and ünïcode",
  ])("round-trips %j", (markdown) => {
    expect(editorJsonToMarkdown(markdownToEditorJson(markdown))).toBe(markdown);
  });

  it("builds the document nodes the editor uses", () => {
    expect(markdownToEditorJson("a **b**\nc")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a " },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "c" },
          ],
        },
      ],
    });
  });

  it("degrades what the editor cannot hold to plain paragraphs", () => {
    expect(editorJsonToMarkdown(markdownToEditorJson("# Title\n\ntext\n\n---\n\nmore"))).toBe(
      "Title\n\ntext\n\nmore",
    );
    expect(markdownToEditorJson("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
