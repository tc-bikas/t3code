import {
  TeamCreateOrganizationInput,
  TeamInviteInput,
  TeamSetMemberRoleInput,
  TeamUpdateOrganizationInput,
} from "@t3tools/contracts";
import { decodeBody, noContent, ok, param, requireAuth, type Route } from "./http.ts";
import {
  acceptInvitation,
  createOrganization,
  declineInvitation,
  deleteOrganization,
  getOrganization,
  inviteMember,
  removeMember,
  revokeInvite,
  setMemberRole,
  updateOrganization,
} from "./orgs.ts";

export const orgRoutes: ReadonlyArray<Route> = [
  {
    method: "POST",
    path: "/v1/orgs",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamCreateOrganizationInput, req.body);
      return ok(await createOrganization(req.ctx, user, input));
    },
  },
  {
    method: "GET",
    path: "/v1/orgs/:id",
    async handle(req) {
      const { user } = await requireAuth(req);
      return ok(await getOrganization(req.ctx, user, param(req, "id")));
    },
  },
  {
    method: "PATCH",
    path: "/v1/orgs/:id",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamUpdateOrganizationInput, req.body);
      return ok(await updateOrganization(req.ctx, user, param(req, "id"), input));
    },
  },
  {
    method: "DELETE",
    path: "/v1/orgs/:id",
    async handle(req) {
      const { user } = await requireAuth(req);
      await deleteOrganization(req.ctx, user, param(req, "id"));
      return noContent;
    },
  },
  {
    method: "POST",
    path: "/v1/orgs/:id/invites",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamInviteInput, req.body);
      return ok(await inviteMember(req.ctx, user, param(req, "id"), input));
    },
  },
  {
    method: "DELETE",
    path: "/v1/orgs/:id/invites/:inviteId",
    async handle(req) {
      const { user } = await requireAuth(req);
      await revokeInvite(req.ctx, user, param(req, "id"), param(req, "inviteId"));
      return noContent;
    },
  },
  {
    method: "PATCH",
    path: "/v1/orgs/:id/members/:userId",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamSetMemberRoleInput, req.body);
      return ok(await setMemberRole(req.ctx, user, param(req, "id"), param(req, "userId"), input));
    },
  },
  {
    method: "DELETE",
    path: "/v1/orgs/:id/members/:userId",
    async handle(req) {
      const { user } = await requireAuth(req);
      await removeMember(req.ctx, user, param(req, "id"), param(req, "userId"));
      return noContent;
    },
  },
  {
    method: "POST",
    path: "/v1/invitations/:id/accept",
    async handle(req) {
      const { user } = await requireAuth(req);
      return ok(await acceptInvitation(req.ctx, user, param(req, "id")));
    },
  },
  {
    method: "POST",
    path: "/v1/invitations/:id/decline",
    async handle(req) {
      const { user } = await requireAuth(req);
      await declineInvitation(req.ctx, user, param(req, "id"));
      return noContent;
    },
  },
];
