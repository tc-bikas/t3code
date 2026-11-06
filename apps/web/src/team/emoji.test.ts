import { TEAM_EMOJI_MAX_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EMOJI_CATEGORIES, QUICK_REACTIONS, searchEmoji } from "./emoji";

describe("emoji data", () => {
  it("lists each quick reaction in the full set", () => {
    const all = new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((entry) => entry.emoji)));
    for (const emoji of QUICK_REACTIONS) expect(all.has(emoji)).toBe(true);
  });

  it("keeps every emoji within the contract's reaction length", () => {
    for (const { emoji } of EMOJI_CATEGORIES.flatMap((c) => c.emojis)) {
      expect(emoji.length).toBeGreaterThan(0);
      expect(emoji.length).toBeLessThanOrEqual(TEAM_EMOJI_MAX_LENGTH);
    }
  });
});

describe("searchEmoji", () => {
  const found = (query: string) => searchEmoji(query).map((entry) => entry.emoji);

  it("is empty for a blank query", () => {
    expect(found("  ")).toEqual([]);
  });

  it("matches names and keywords case-insensitively", () => {
    expect(found("THUMBS")).toContain("👍");
    expect(found("congrats")).toEqual(expect.arrayContaining(["🎉", "👏"]));
  });

  it("ranks name matches first and requires every term", () => {
    expect(found("fire")[0]).toBe("🔥");
    expect(found("thumbs down")).toEqual(["👎"]);
    expect(found("zzzzqq")).toEqual([]);
  });
});
