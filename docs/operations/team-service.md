# Team service

`apps/team` (`@t3tools/team`) is an optional, standalone HTTP service for accounts and organisations. It is separate from any T3 server and will later host team chat. Clients talk to it with `Authorization: Bearer <token>`; the typed contract is [`packages/contracts/src/team.ts`](../../packages/contracts/src/team.ts).

## Run locally

```sh
vp run dev:team
```

It listens on `http://127.0.0.1:3790`. With no `DATABASE_URL` it uses embedded Postgres ([PGlite](https://pglite.dev)) stored in `.t3-team/pgdata` under the working directory, so nothing needs installing. Mail is printed to the terminal, and responses carry a `devLink` so you can finish verification, reset and invitation flows without reading it.

## Environment

| Variable                            | Default                 | Purpose                                                                           |
| ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `TEAM_PORT`                         | `3790`                  | Port to listen on. Railway sets `PORT`; map it with `TEAM_PORT=${{PORT}}`.        |
| `TEAM_HOST`                         | `127.0.0.1`             | Bind address. Local only by default; use `0.0.0.0` when deployed.                 |
| `DATABASE_URL`                      | unset                   | Postgres connection string. When set, `pg` is used instead of PGlite.             |
| `TEAM_DATA_DIR`                     | `<cwd>/.t3-team/pgdata` | PGlite data directory (ignored when `DATABASE_URL` is set).                       |
| `TEAM_PUBLIC_URL`                   | `http://localhost:3790` | Public origin used to build links in email.                                       |
| `RESEND_API_KEY`, `TEAM_EMAIL_FROM` | unset                   | Send mail through Resend. Both are needed; without them mail goes to the console. |

Migrations run at startup. The service makes no outbound calls except to Resend when configured.

## Deploy on Railway

1. Create a service from this repo and add the Postgres plugin to the project.
2. Start command: `node apps/team/src/bin.ts` (after `vp i` or `pnpm install --filter @t3tools/team...`).
3. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `TEAM_HOST=0.0.0.0`, `TEAM_PORT=${{PORT}}`, `TEAM_PUBLIC_URL=https://<your-domain>`, `RESEND_API_KEY` and `TEAM_EMAIL_FROM` (a sender verified in Resend).
4. Check `GET /v1/health`.

Rate limits are in memory and keyed on the last `X-Forwarded-For` entry, so run one instance.

## Routes

Errors are `{ "error": { "code", "message" } }`. Statuses: invalid-input 400, unauthorized 401, invalid-credentials 401, forbidden 403, email-not-verified 403, not-found 404, email-taken 409, last-owner 409, already-member 409, invite-expired 410, weak-password 400, domain-not-allowed 400, rate-limited 429, unavailable 503.

| Route                                                | Auth    | Notes                                                            |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `GET /v1/health`                                     | none    |                                                                  |
| `POST /v1/auth/signup`                               | none    | Returns a session token; sends a verification email.             |
| `POST /v1/auth/login`                                | none    | Works before email verification.                                 |
| `POST /v1/auth/logout`                               | session | 204                                                              |
| `POST /v1/auth/resend-verification`                  | session |                                                                  |
| `POST /v1/auth/forgot-password`                      | none    | Always 200.                                                      |
| `GET /verify-email?token=`                           | link    | HTML. Verifies and joins auto-join organisations.                |
| `GET /reset-password?token=`, `POST /reset-password` | link    | HTML form. Ends every session.                                   |
| `GET /v1/me`, `PATCH /v1/me`                         | session | Profile, memberships, pending invitations (verified email only). |
| `POST /v1/me/password`                               | session | Ends all other sessions. 204                                     |
| `POST /v1/me/delete`                                 | session | Password required. 204                                           |
| `GET /v1/me/sessions`, `DELETE /v1/me/sessions/:id`  | session | Own sessions only.                                               |
| `POST /v1/orgs`                                      | session | Verified email. Creator becomes owner.                           |
| `GET`, `PATCH`, `DELETE /v1/orgs/:id`                | session | Members only (others get 404). Delete is owner only.             |
| `POST /v1/orgs/:id/invites`                          | session | Owner or admin; replaces a pending invite for that email.        |
| `DELETE /v1/orgs/:id/invites/:inviteId`              | session | Owner or admin. 204                                              |
| `PATCH /v1/orgs/:id/members/:userId`                 | session | Owner only; sets the role.                                       |
| `DELETE /v1/orgs/:id/members/:userId`                | session | Owner any, admin plain members, anyone themselves. 204           |
| `POST /v1/invitations/:id/accept`                    | session | Verified email equal to the invited one.                         |
| `POST /v1/invitations/:id/decline`                   | session | 204                                                              |
