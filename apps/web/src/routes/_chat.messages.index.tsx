import { createFileRoute } from "@tanstack/react-router";

import { MessagesPage } from "../components/messages/MessagesPage";

function MessagesIndexRoute() {
  return <MessagesPage conversationId={null} />;
}

export const Route = createFileRoute("/_chat/messages/")({
  component: MessagesIndexRoute,
});
