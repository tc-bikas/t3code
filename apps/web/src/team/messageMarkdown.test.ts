import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vite-plus/test";

import { editorJsonToMarkdown, markdownToPlainText } from "./messageMarkdown";

type MarkInput = string | { type: string; attrs: Record<string, unknown> };
const text = (value: string, ...marks: MarkInput[]): JSONContent => ({
  type: "text",
  text: value,
  marks: marks.map((mark) => (typeof mark === "string" ? { type: mark } : mark)),
});
const para = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const item = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });

describe("editorJsonToMarkdown", () => {
  it("writes marks with whitespace outside the delimiters", () => {
    expect(
      editorJsonToMarkdown(
        doc(
          para(
            text("a "),
            text("bold ", "bold"),
            text("both", "bold", "italic"),
            text(" gone", "strike"),
            text(" "),
            text("x`y", "code"),
            text(" "),
            text("site", { type: "link", attrs: { href: "https://x.test/a(b)" } }),
          ),
        ),
      ),
    ).toBe("a **bold** ***both*** ~~gone~~ ``x`y`` [site](https://x.test/a%28b%29)");
  });

  it("escapes literal syntax but not URLs or snake_case", () => {
    expect(
      editorJsonToMarkdown(
        doc(
          para(text("2 * 3 and snake_case and _x_ see https://x.test/a_b_c*d")),
          para(text("# not a heading")),
          para(text("1. not a list"), { type: "hardBreak" }, text("- nor this")),
        ),
      ),
    ).toBe(
      "2 \\* 3 and snake_case and \\_x\\_ see https://x.test/a_b_c*d\n\n\\# not a heading\n\n1\\. not a list\n\\- nor this",
    );
  });

  it("writes blocks, nesting and a longer fence around backticks", () => {
    expect(
      editorJsonToMarkdown(
        doc(
          {
            type: "bulletList",
            content: [
              item(para(text("a")), {
                type: "orderedList",
                attrs: { start: 3 },
                content: [item(para(text("b")))],
              }),
              item(para(text("c"))),
            ],
          },
          { type: "blockquote", content: [para(text("q1")), para(text("q2"))] },
          { type: "codeBlock", attrs: { language: "ts" }, content: [text("a ```\nb")] },
          para(),
        ),
      ),
    ).toBe("- a\n  3. b\n- c\n\n> q1\n>\n> q2\n\n````ts\na ```\nb\n````");
  });
});

describe("markdownToPlainText", () => {
  it("strips formatting to readable text", () => {
    expect(
      markdownToPlainText(
        "## Title\n> quoted **bold** and _it_ and ~~gone~~\n- [x] task `a*b*c`\n1. [site](https://x.test) ![alt](https://x.test/i.png)\n```ts\nconst a = 1;\n```",
      ),
    ).toBe("Title quoted bold and it and gone task a*b*c site alt const a = 1;");
  });

  it("keeps escaped and arithmetic characters", () => {
    expect(markdownToPlainText("2 * 3 * 4 and snake_case and \\*not\\* \\# x")).toBe(
      "2 * 3 * 4 and snake_case and *not* # x",
    );
  });
});
