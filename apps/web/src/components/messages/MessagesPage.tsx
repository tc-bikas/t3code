import { useNavigate } from "@tanstack/react-router";
import { MessageCirclePlusIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useTeamMessages } from "../../team/useTeamMessages";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ConversationView } from "./ConversationView";
import { NewMessageDialog } from "./NewMessageDialog";

function SignedOutState() {
  const navigate = useNavigate();
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Sign in to send messages</EmptyTitle>
        <EmptyDescription>Direct messages use your T3 account.</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" onClick={() => void navigate({ to: "/settings/account" })}>
        Open account settings
      </Button>
    </Empty>
  );
}

export function MessagesPage({ conversationId }: { readonly conversationId: string | null }) {
  const { scope, state } = useTeamMessages();
  const [dialogOpen, setDialogOpen] = useState(false);
  const active = state.conversations.find((entry) => entry.id === conversationId);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Messages</h1>
          <div className="min-w-0 flex-1" />
          {scope === null ? null : (
            <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
              <MessageCirclePlusIcon aria-hidden="true" />
              New message
            </Button>
          )}
        </WorkspacePageHeader>

        {scope === null ? (
          <SignedOutState />
        ) : (
          <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {conversationId === null ? (
              <Empty className="flex-1">
                <EmptyHeader>
                  <MessageSquareIcon aria-hidden="true" className="mb-3 size-6 text-icon-muted" />
                  <EmptyTitle>Select a conversation</EmptyTitle>
                  <EmptyDescription>
                    Pick someone under Direct messages in the sidebar, or start a new message.
                  </EmptyDescription>
                </EmptyHeader>
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  New message
                </Button>
              </Empty>
            ) : (
              <ConversationView
                key={conversationId}
                scope={scope}
                conversationId={conversationId}
                conversation={active}
                thread={state.threads[conversationId]}
                listReady={state.listStatus === "ready"}
              />
            )}
          </section>
        )}
      </div>
      {scope === null ? null : <NewMessageDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </SidebarInset>
  );
}
