import type { TeamConversation, TeamMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  compareMessageIds,
  createSseParser,
  dayLabel,
  groupMessagesByDay,
  applyMessageUpdate,
  applyReaction,
  isOwnLiveMessage,
  messagePreview,
  mergeMessages,
  nextJumpStep,
  reactionWho,
  replySnippet,
  openConversationId,
  previewText,
  reconnectDelayMs,
  parsePullRequestUrl,
  startsMessageRun,
  totalUnread,
  upsertConversation,
} from "./messages.logic";

const message = (id: string, createdAt = "2026-05-01T12:00:00"): TeamMessage => ({
  id,
  conversationId: "c1",
  senderId: "u1",
  body: `m${id}`,
  createdAt,
  editedAt: null,
  deleted: false,
  replyTo: null,
  reactions: [],
});

const conversation = (id: string, updatedAt: string, unreadCount = 0): TeamConversation => ({
  id,
  peer: { id: `p${id}`, name: "Peer", githubLogin: "peer", avatarUrl: null },
  lastMessage: null,
  unreadCount,
  updatedAt,
});

describe("message ids and merging", () => {
  it("compares ids as numbers", () => {
    expect(compareMessageIds("9", "10")).toBeLessThan(0);
    expect(compareMessageIds("12345678901234567890", "12345678901234567891")).toBeLessThan(0);
    expect(compareMessageIds("5", "5")).toBe(0);
  });

  it("dedupes, orders oldest first, and keeps the newest within the limit", () => {
    const merged = mergeMessages([message("10"), message("9")], [message("10"), message("11")], 3);
    expect(merged.map((entry) => entry.id)).toEqual(["9", "10", "11"]);
    expect(mergeMessages(merged, [message("12")], 3).map((entry) => entry.id)).toEqual([
      "10",
      "11",
      "12",
    ]);
  });
});

describe("conversation list", () => {
  it("moves an updated conversation to the top without duplicating it", () => {
    const list = [
      conversation("a", "2026-05-02T00:00:00Z"),
      conversation("b", "2026-05-01T00:00:00Z"),
    ];
    const next = upsertConversation(list, conversation("b", "2026-05-03T00:00:00Z", 2));
    expect(next.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(totalUnread(next)).toBe(2);
  });
});

describe("previewText", () => {
  it("flattens whitespace and truncates", () => {
    expect(previewText("a\n\n b   c")).toBe("a b c");
    expect(previewText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    expect(previewText("**Ship** it, see [the PR](https://x.test/1)")).toBe("Ship it, see the PR");
  });
});

describe("day grouping", () => {
  it("groups consecutive messages by local day", () => {
    const groups = groupMessagesByDay([
      message("1", "2026-05-01T12:00:00"),
      message("2", "2026-05-01T12:30:00"),
      message("3", "2026-05-03T12:00:00"),
    ]);
    expect(groups.map((group) => group.messages.length)).toEqual([2, 1]);
  });

  it("labels today and yesterday", () => {
    const now = new Date("2026-05-03T12:00:00");
    expect(dayLabel("2026-05-03T09:00:00", now)).toBe("Today");
    expect(dayLabel("2026-05-02T09:00:00", now)).toBe("Yesterday");
  });
});

describe("createSseParser", () => {
  it("emits data lines across chunk boundaries and skips comments", () => {
    const seen: string[] = [];
    const feed = createSseParser((data) => seen.push(data));
    feed(': ping\n\ndata: {"a"');
    feed(":1}\r\n\r\ndata:two\n");
    expect(seen).toEqual(['{"a":1}', "two"]);
  });
});

describe("helpers", () => {
  it("backs off exponentially up to a cap", () => {
    expect([0, 1, 2, 10].map(reconnectDelayMs)).toEqual([1_000, 2_000, 4_000, 30_000]);
  });

  it("reads the open conversation from the path", () => {
    expect(openConversationId("/messages/42")).toBe("42");
    expect(openConversationId("/messages")).toBeNull();
  });
});

describe("parsePullRequestUrl", () => {
  it("reads GitHub pull request URLs only", () => {
    expect(parsePullRequestUrl("https://github.com/acme/app/pull/42/files")).toEqual({
      repository: "acme/app",
      number: 42,
    });
    expect(parsePullRequestUrl("https://github.com/acme/app/issues/3")).toBeNull();
    expect(parsePullRequestUrl("https://example.com/acme/app/pull/42")).toBeNull();
    expect(parsePullRequestUrl("not a url")).toBeNull();
  });
});

describe("startsMessageRun", () => {
  it("groups one sender's messages until a five minute pause", () => {
    const at = (time: string) => ({ senderId: "a", createdAt: `2030-01-01T${time}Z` });
    expect(startsMessageRun(undefined, at("10:00:00"))).toBe(true);
    expect(startsMessageRun(at("10:00:00"), at("10:04:59"))).toBe(false);
    expect(startsMessageRun(at("10:00:00"), at("10:05:01"))).toBe(true);
    expect(startsMessageRun(at("10:00:00"), { ...at("10:00:10"), senderId: "b" })).toBe(true);
  });
});

describe("reactions", () => {
  it("adds and removes one person's reaction idempotently", () => {
    const added = applyReaction([], "👍", "me", true);
    expect(added).toEqual([{ emoji: "👍", userIds: ["me"] }]);
    expect(applyReaction(added, "👍", "me", true)).toBe(added);
    const both = applyReaction(added, "👍", "ada", true);
    expect(both).toEqual([{ emoji: "👍", userIds: ["me", "ada"] }]);
    expect(applyReaction(both, "👍", "me", false)).toEqual([{ emoji: "👍", userIds: ["ada"] }]);
    expect(applyReaction(added, "👍", "me", false)).toEqual([]);
    expect(applyReaction(added, "❤️", "me", false)).toBe(added);
  });

  it("names who reacted, you first", () => {
    const names = { me: "Me", ada: "Ada Demo" };
    expect(reactionWho(["ada", "me"], "me", names)).toBe("You, Ada Demo");
    expect(reactionWho(["ada", "zed"], "me", names)).toBe("Ada Demo, Someone");
  });
});

describe("message updates", () => {
  const reply = (id: string, to: string): TeamMessage => ({
    ...message(id),
    replyTo: { id: to, senderId: "u1", body: "old", deleted: false },
  });

  it("replaces a loaded message and refreshes quotes of it, but never adds an unloaded one", () => {
    const loaded = [message("1"), reply("2", "1"), reply("3", "9")];
    const deleted = { ...message("1"), body: "", deleted: true };
    const next = applyMessageUpdate(loaded, deleted);
    expect(next[0]).toBe(deleted);
    expect(next[1]?.replyTo).toEqual({ id: "1", senderId: "u1", body: "", deleted: true });
    expect(next[2]).toBe(loaded[2]);
    expect(applyMessageUpdate(loaded, message("0"))).toBe(loaded);
    const edited = applyMessageUpdate(loaded, { ...message("1"), body: "x".repeat(300) });
    expect(edited[1]?.replyTo?.body).toHaveLength(200);
  });

  it("previews deleted messages and quotes", () => {
    expect(messagePreview({ ...message("1"), body: "", deleted: true })).toBe("Message deleted");
    expect(messagePreview({ ...message("1"), body: "**hi**" })).toBe("hi");
    expect(replySnippet({ body: "", deleted: true })).toBe("Original message was deleted");
    expect(replySnippet({ body: "a *b*\n\nc", deleted: false })).toBe("a b c");
  });

  it("allows edits only on your own live messages", () => {
    expect(isOwnLiveMessage(message("1"), "u1")).toBe(true);
    expect(isOwnLiveMessage(message("1"), "u2")).toBe(false);
    expect(isOwnLiveMessage({ ...message("1"), deleted: true }, "u1")).toBe(false);
  });
});

describe("nextJumpStep", () => {
  it("finds, loads earlier pages, or gives up within the cap", () => {
    expect(nextJumpStep(["5", "6"], true, "6")).toBe("found");
    expect(nextJumpStep(["5", "6"], true, "2")).toBe("load-earlier");
    expect(nextJumpStep(["5", "6"], false, "2")).toBe("give-up");
    expect(nextJumpStep(["5", "7"], true, "6")).toBe("give-up");
    expect(nextJumpStep(["5", "6"], true, "2", 2)).toBe("give-up");
    expect(nextJumpStep([], true, "2")).toBe("give-up");
  });
});
