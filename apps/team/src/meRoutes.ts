import { TeamUpdateProfileInput, type TeamSessionsResult } from "@t3tools/contracts";
import { decodeBody, noContent, ok, param, requireAuth, type Route } from "./http.ts";
import { deleteAccount, getMe, listSessions, revokeSession, updateProfile } from "./profile.ts";

export const meRoutes: ReadonlyArray<Route> = [
  {
    method: "GET",
    path: "/v1/me",
    async handle(req) {
      return ok(await getMe(req.ctx, (await requireAuth(req)).user));
    },
  },
  {
    method: "PATCH",
    path: "/v1/me",
    async handle(req) {
      const { user } = await requireAuth(req);
      return ok(await updateProfile(req.ctx, user, decodeBody(TeamUpdateProfileInput, req.body)));
    },
  },
  {
    method: "DELETE",
    path: "/v1/me",
    async handle(req) {
      await deleteAccount(req.ctx, (await requireAuth(req)).user);
      return noContent;
    },
  },
  {
    method: "GET",
    path: "/v1/me/sessions",
    async handle(req) {
      const result: TeamSessionsResult = {
        sessions: await listSessions(req.ctx, await requireAuth(req)),
      };
      return ok(result);
    },
  },
  {
    method: "DELETE",
    path: "/v1/me/sessions/:id",
    async handle(req) {
      await revokeSession(req.ctx, await requireAuth(req), param(req, "id"));
      return noContent;
    },
  },
];
