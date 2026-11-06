import {
  TeamGithubStartInput,
  type TeamAuthConfig,
  type TeamGithubPollResult,
  type TeamGithubStartResult,
} from "@t3tools/contracts";
import { decodeBody, noContent, ok, requireAuth, type Route } from "./http.ts";
import { pollGithubSignIn, signOut, startGithubSignIn } from "./signin.ts";

export const authRoutes: ReadonlyArray<Route> = [
  {
    method: "GET",
    path: "/v1/auth/config",
    async handle(req) {
      const config: TeamAuthConfig = { githubConfigured: req.ctx.github !== undefined };
      return ok(config);
    },
  },
  {
    method: "POST",
    path: "/v1/auth/github/start",
    async handle(req) {
      const result: TeamGithubStartResult = await startGithubSignIn(
        req.ctx,
        decodeBody(TeamGithubStartInput, req.body),
        req.ip,
      );
      return ok(result);
    },
  },
  {
    method: "GET",
    path: "/v1/auth/github/poll",
    async handle(req) {
      const result: TeamGithubPollResult = await pollGithubSignIn(
        req.ctx,
        req.query.get("state") ?? "",
      );
      return ok(result);
    },
  },
  {
    method: "POST",
    path: "/v1/auth/logout",
    async handle(req) {
      await signOut(req.ctx, await requireAuth(req));
      return noContent;
    },
  },
];
