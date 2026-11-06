# Team service

`apps/team` (`@t3tools/team`) is an optional, standalone HTTP service for GitHub sign-in and organisations. It is separate from any T3 server and will later host team chat. Clients talk to it with `Authorization: Bearer <token>`; the typed contract is [`packages/contracts/src/team.ts`](../../packages/contracts/src/team.ts). Design notes are in [Team service internals](../internals/team.md).

## Create the GitHub OAuth App

Sign-in needs a GitHub OAuth App (not a GitHub App).

1. GitHub > Settings > Developer settings > OAuth Apps > New OAuth App.
2. Homepage URL: `http://localhost:3790`.
3. Authorization callback URL: `http://localhost:3790/auth/github/callback`.
4. Create the app, then generate a client secret.
5. Put the credentials in the repo-root `.env` (gitignored; `dev` and `start` load it when present):

```sh
TEAM_GITHUB_CLIENT_ID=...
TEAM_GITHUB_CLIENT_SECRET=...
```

For a deployment, make a second OAuth App whose homepage is the public URL and whose callback is `<public URL>/auth/github/callback`. The callback is always `${TEAM_PUBLIC_URL}/auth/github/callback`, so `TEAM_PUBLIC_URL` must match what you registered. Without both variables the service runs, `GET /v1/auth/config` reports `githubConfigured: false`, and sign-in start answers `not-configured`.

## Run locally

```sh
vp run dev:team
```

It listens on `http://127.0.0.1:3790`. With no `DATABASE_URL` it uses embedded Postgres ([PGlite](https://pglite.dev)) stored in `.t3-team/pgdata` under the working directory, so nothing needs installing.

## Environment

| Variable                    | Default                 | Purpose                                                                          |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `TEAM_GITHUB_CLIENT_ID`     | unset                   | OAuth App client id. Both GitHub variables are needed for sign-in.               |
| `TEAM_GITHUB_CLIENT_SECRET` | unset                   | OAuth App client secret.                                                         |
| `TEAM_PUBLIC_URL`           | `http://localhost:3790` | Public origin; the GitHub callback is `${TEAM_PUBLIC_URL}/auth/github/callback`. |
| `DATABASE_URL`              | unset                   | Postgres connection string. When set, `pg` is used instead of PGlite.            |
| `TEAM_PORT`                 | `3790`                  | Port to listen on. Railway sets `PORT`; map it with `TEAM_PORT=${{PORT}}`.       |
| `TEAM_HOST`                 | `127.0.0.1`             | Bind address. Local only by default; use `0.0.0.0` when deployed.                |
| `TEAM_DATA_DIR`             | `<cwd>/.t3-team/pgdata` | PGlite data directory (ignored when `DATABASE_URL` is set).                      |

Migrations run at startup. The service's only outbound calls are to `github.com` and `api.github.com`.

Migration 2 replaced the earlier email-and-password schema and dropped its users, sessions and organisations. That data was development-only; nothing is migrated.

## Deploy on Railway

1. Create a service from this repo and add the Postgres plugin to the project.
2. Start command: `node apps/team/src/bin.ts` (after `vp i` or `pnpm install --filter @t3tools/team...`).
3. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `TEAM_HOST=0.0.0.0`, `TEAM_PORT=${{PORT}}`, `TEAM_PUBLIC_URL=https://<your-domain>`, `TEAM_GITHUB_CLIENT_ID` and `TEAM_GITHUB_CLIENT_SECRET`.
4. Check `GET /v1/health` and `GET /v1/auth/config`.

The sign-in start limit is in memory and keyed on the last `X-Forwarded-For` entry, so run one instance.

## Work email

Invitations are not emailed; people see them in the app. An invitation or an auto-join domain matches any email that GitHub has verified for the account, not only the primary one. To match your employer, add your work email to your GitHub account (Settings > Emails) and verify it, then sign in again; each sign-in replaces the stored emails with GitHub's current list.

## Routes

Errors are `{ "error": { "code", "message" } }`. Statuses: invalid-input 400, unauthorized 401, forbidden 403, not-found 404, not-configured 503, domain-not-allowed 400, last-owner 409, already-member 409, invite-expired 410, unavailable 503, rate-limited 429 (too many sign-ins start from one IP).

| Route                                               | Auth    | Notes                                                                      |
| --------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `GET /v1/health`                                    | none    |                                                                            |
| `GET /v1/auth/config`                               | none    | `{ githubConfigured }`.                                                    |
| `POST /v1/auth/github/start`                        | none    | Returns `authorizeUrl` and `state`. `not-configured` when unset.           |
| `GET /auth/github/callback?code&state`              | none    | HTML. GitHub redirects here; completes the sign-in.                        |
| `GET /v1/auth/github/poll?state=`                   | none    | `pending`, `complete` (once), or `failed`.                                 |
| `POST /v1/auth/logout`                              | session | 204                                                                        |
| `GET /v1/me`, `PATCH /v1/me`                        | session | Profile, verified emails, memberships, pending invitations. PATCH renames. |
| `DELETE /v1/me`                                     | session | Deletes the account. 204                                                   |
| `GET /v1/me/sessions`, `DELETE /v1/me/sessions/:id` | session | Own sessions only.                                                         |
| `POST /v1/orgs`                                     | session | Creator becomes owner.                                                     |
| `GET`, `PATCH`, `DELETE /v1/orgs/:id`               | session | Members only (others get 404). Delete is owner only.                       |
| `POST /v1/orgs/:id/invites`                         | session | Owner or admin; replaces a pending invite for that email.                  |
| `DELETE /v1/orgs/:id/invites/:inviteId`             | session | Owner or admin. 204                                                        |
| `PATCH /v1/orgs/:id/members/:userId`                | session | Owner only; sets the role.                                                 |
| `DELETE /v1/orgs/:id/members/:userId`               | session | Owner any, admin plain members, anyone themselves. 204                     |
| `POST /v1/invitations/:id/accept`                   | session | Invitation email must be one of the user's verified emails.                |
| `POST /v1/invitations/:id/decline`                  | session | 204                                                                        |
