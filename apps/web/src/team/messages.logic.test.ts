import type { TeamConversation, TeamMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  compareMessageIds,
  createSseParser,
  dayLabel,
  groupMessagesByDay,
  mergeMessages,
  openConversationId,
  previewText,
  reconnectDelayMs,
  splitMessageText,
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

describe("splitMessageText", () => {
  it("finds links and pull requests, and leaves sentence punctuation out of them", () => {
    expect(
      splitMessageText(
        "Review https://github.com/acme/app/pull/42/files, then see (https://example.com/a_(b)) or https://example.com.",
      ),
    ).toEqual([
      { kind: "text", text: "Review " },
      {
        kind: "pull-request",
        url: "https://github.com/acme/app/pull/42/files",
        repository: "acme/app",
        number: 42,
      },
      { kind: "text", text: ", then see (" },
      { kind: "link", url: "https://example.com/a_(b)" },
      { kind: "text", text: ") or " },
      { kind: "link", url: "https://example.com" },
      { kind: "text", text: "." },
    ]);
    expect(splitMessageText("no links here")).toEqual([{ kind: "text", text: "no links here" }]);
    expect(splitMessageText("https://github.com/acme/app/issues/3")).toEqual([
      { kind: "link", url: "https://github.com/acme/app/issues/3" },
    ]);
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
