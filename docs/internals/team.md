# Team service

Operating notes are in [Team service](../operations/team-service.md). This page keeps the decisions and traps.

- **Separate from the T3 server.** Accounts and organisations span environments and must exist for users who run no server at all, and the T3 server owns one machine's state. The service has its own database and release, and `npx t3` never depends on it. It is optional: nothing in T3 Code requires an account.
- **Bearer tokens and `Access-Control-Allow-Origin: *`.** Clients (web, desktop, mobile, app.t3.codes) hold a token and send it in a header, never a cookie, so a cross-origin page cannot ride the user's session and wildcard CORS is safe. Only the token's sha256 is stored. The HTML pages (`/verify-email`, `/reset-password`) are the only cookie-free browser surfaces and carry a locked-down CSP.
- **Console mail and `devLink`.** With no Resend key, mail is printed and responses include `devLink`, so a developer can finish flows locally. `devLink` appears only in console mode; in production it must never leave the server. In console mode `forgot-password` therefore reveals whether an address has an account.
- **Verified email gates trust.** Sign-in works unverified, but creating or inviting into organisations, accepting invitations, claiming a domain, and seeing invitations all need a verified email. Otherwise anyone could claim an address they do not own and read its invitations. Invitations are matched on the address, not on an account.
- **Domain claiming.** An owner can enable auto-join only for the domain of their own verified email, never for public providers, and each domain belongs to one organisation (a unique index backs the check). Enabling it also adds existing verified accounts; verifying an email adds the user to matching organisations as `member`.
- **Verification links are GETs that consume the token.** A mail scanner that prefetches the link will verify the address. That is tolerated because the token only proves mailbox access; do not hang a destructive action on a GET link.
- **Last owner.** Owner rows are locked (`FOR UPDATE`) in the same transaction as the check, so two concurrent demotions cannot leave an organisation with no owner.
- **Rate limits are per process.** They live in memory and key on the last `X-Forwarded-For` entry, so they assume one instance behind one trusted proxy.
