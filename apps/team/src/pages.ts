import { isResetTokenValid, resetPassword, verifyEmail } from "./accounts.ts";
import { TeamError } from "./errors.ts";
import type { Reply, Route } from "./http.ts";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(status: number, heading: string, body: string): Reply {
  return {
    status,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
input,button{font:inherit;padding:.5rem;width:100%;box-sizing:border-box;margin-top:.5rem}button{cursor:pointer}
.error{color:#b00020}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style>
</head><body><h1>${escapeHtml(heading)}</h1>${body}</body></html>`,
  };
}

const message = (status: number, heading: string, text: string) =>
  page(status, heading, `<p>${escapeHtml(text)}</p>`);

const resetForm = (token: string, error?: string) =>
  page(
    error ? 400 : 200,
    "Choose a new password",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/reset-password">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<label>New password<input type="password" name="password" minlength="10" maxlength="200" autocomplete="new-password" required autofocus></label>
<button type="submit">Set password</button>
</form>`,
  );

const INVALID_LINK = "This link is invalid, has expired, or was already used.";

export const pageRoutes: ReadonlyArray<Route> = [
  {
    method: "GET",
    path: "/verify-email",
    async handle(req) {
      const verified = await verifyEmail(req.ctx, req.query.get("token") ?? "");
      return verified
        ? message(
            200,
            "Email confirmed",
            "Your email address is confirmed. You can close this tab and return to T3 Code.",
          )
        : message(400, "Link not valid", INVALID_LINK);
    },
  },
  {
    method: "GET",
    path: "/reset-password",
    async handle(req) {
      const token = req.query.get("token") ?? "";
      return (await isResetTokenValid(req.ctx, token))
        ? resetForm(token)
        : message(400, "Link not valid", INVALID_LINK);
    },
  },
  {
    method: "POST",
    path: "/reset-password",
    async handle(req) {
      const form = new URLSearchParams(req.body);
      const token = form.get("token") ?? "";
      try {
        await resetPassword(req.ctx, token, form.get("password") ?? "");
      } catch (cause) {
        if (!(cause instanceof TeamError)) throw cause;
        return cause.code === "weak-password"
          ? resetForm(token, cause.message)
          : message(400, "Link not valid", INVALID_LINK);
      }
      return message(
        200,
        "Password changed",
        "Your password was changed and all devices were signed out. Sign in again in T3 Code.",
      );
    },
  },
];
