import { createFileRoute } from "@tanstack/react-router";

import { MessagesPage } from "../components/messages/MessagesPage";

function MessagesConversationRoute() {
  const { conversationId } = Route.useParams();
  return <MessagesPage conversationId={conversationId} />;
}

export const Route = createFileRoute("/_chat/messages/$conversationId")({
  component: MessagesConversationRoute,
});
