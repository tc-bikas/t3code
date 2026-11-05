import { describe, expect, it } from "vite-plus/test";

import { formatIssueReference, resolveLinkIssueView } from "./composerLinkIssue";

describe("resolveLinkIssueView", () => {
  it("keeps waiting only while Trellis is still disconnected", () => {
    const base = { statusError: null, waitingForTrellis: true } as const;
    expect(resolveLinkIssueView({ ...base, status: null })).toEqual({ kind: "checking" });
    expect(resolveLinkIssueView({ ...base, status: { state: "disconnected" } })).toEqual({
      kind: "waiting",
    });
    expect(
      resolveLinkIssueView({
        ...base,
        status: { state: "connected", workspaceHandle: "acme" },
      }),
    ).toEqual({ kind: "connected" });
    expect(
      resolveLinkIssueView({ status: null, statusError: "offline", waitingForTrellis: false }),
    ).toEqual({ kind: "error", message: "offline" });
  });
});

describe("formatIssueReference", () => {
  it("adds the link on its own line only when the issue has one", () => {
    expect(
      formatIssueReference({ code: "WEB-12", title: " Fix\n the  thing ", url: undefined }),
    ).toBe("WEB-12: Fix the thing ");
    expect(
      formatIssueReference({ code: "WEB-12", title: "Fix", url: "https://t.example/WEB-12" }),
    ).toBe("WEB-12: Fix\nhttps://t.example/WEB-12 ");
  });
});
