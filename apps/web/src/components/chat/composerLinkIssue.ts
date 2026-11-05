import type { TrellisIssue, TrellisStatus } from "@t3tools/contracts";

export type LinkIssueView =
  | { readonly kind: "checking" }
  | { readonly kind: "not-configured"; readonly message: string }
  | { readonly kind: "disconnected" }
  | { readonly kind: "waiting" }
  | { readonly kind: "connected" }
  | { readonly kind: "error"; readonly message: string };

/** What the dialog offers, from the last status answer and whether a consent tab is open. */
export function resolveLinkIssueView(input: {
  readonly status: TrellisStatus | null;
  readonly statusError: string | null;
  readonly waitingForTrellis: boolean;
}): LinkIssueView {
  const { status } = input;
  if (status === null) {
    return input.statusError === null
      ? { kind: "checking" }
      : { kind: "error", message: input.statusError };
  }
  switch (status.state) {
    case "connected":
      return { kind: "connected" };
    case "not-configured":
      return { kind: "not-configured", message: status.message };
    case "error":
      return { kind: "error", message: status.message };
    case "disconnected":
      return input.waitingForTrellis ? { kind: "waiting" } : { kind: "disconnected" };
  }
}

/** The text a picked issue adds to the prompt: its code and title, then its link when known. */
export function formatIssueReference(issue: Pick<TrellisIssue, "code" | "title" | "url">): string {
  const title = issue.title.replace(/\s+/g, " ").trim();
  return `${issue.code}: ${title}${issue.url === undefined ? "" : `\n${issue.url}`} `;
}
