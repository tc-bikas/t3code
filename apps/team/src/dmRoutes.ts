import {
  TeamMarkReadInput,
  TeamSendMessageInput,
  TeamStartConversationInput,
  type TeamConversationsResult,
  type TeamUserSearchResult,
} from "@t3tools/contracts";
import { openEventStream } from "./events.ts";
import { decodeBody, noContent, ok, param, requireAuth, type Route } from "./http.ts";
import {
  listConversations,
  listMessages,
  markRead,
  searchUsers,
  sendMessage,
  startConversation,
} from "./messages.ts";

export const dmRoutes: ReadonlyArray<Route> = [
  {
    method: "GET",
    path: "/v1/users/search",
    async handle(req) {
      const { user } = await requireAuth(req);
      const result: TeamUserSearchResult = {
        users: await searchUsers(req.ctx, user, req.query.get("q") ?? ""),
      };
      return ok(result);
    },
  },
  {
    method: "GET",
    path: "/v1/conversations",
    async handle(req) {
      const { user } = await requireAuth(req);
      const result: TeamConversationsResult = {
        conversations: await listConversations(req.ctx, user),
      };
      return ok(result);
    },
  },
  {
    method: "POST",
    path: "/v1/conversations",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamStartConversationInput, req.body);
      return ok(await startConversation(req.ctx, user, input.userId));
    },
  },
  {
    method: "GET",
    path: "/v1/conversations/:id/messages",
    async handle(req) {
      const { user } = await requireAuth(req);
      return ok(
        await listMessages(req.ctx, user, param(req, "id"), {
          before: req.query.get("before"),
          limit: req.query.get("limit"),
        }),
      );
    },
  },
  {
    method: "POST",
    path: "/v1/conversations/:id/messages",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamSendMessageInput, req.body);
      return ok(await sendMessage(req.ctx, user, param(req, "id"), input.body));
    },
  },
  {
    method: "POST",
    path: "/v1/conversations/:id/read",
    async handle(req) {
      const { user } = await requireAuth(req);
      const input = decodeBody(TeamMarkReadInput, req.body);
      await markRead(req.ctx, user, param(req, "id"), input.upToMessageId);
      return noContent;
    },
  },
  {
    method: "GET",
    path: "/v1/events",
    async handle(req) {
      const { user } = await requireAuth(req);
      return {
        status: 200,
        stream: (out) => openEventStream(req.ctx, user.id, req.authorization, out),
      };
    },
  },
];
