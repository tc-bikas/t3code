import type { Reply, Route } from "./http.ts";
import { completeGithubSignIn } from "./signin.ts";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(status: number, heading: string, text: string): Reply {
  return {
    status,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style>
</head><body><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p></body></html>`,
  };
}

export const pageRoutes: ReadonlyArray<Route> = [
  {
    method: "GET",
    path: "/auth/github/callback",
    async handle(req) {
      const outcome = await completeGithubSignIn(req.ctx, req.query);
      return outcome.ok
        ? page(200, "Signed in", outcome.message)
        : page(400, "Sign-in failed", outcome.message);
    },
  },
];
