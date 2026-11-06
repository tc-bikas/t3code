import { TeamAvatar } from "../../team/TeamAvatar";
import { useTeamAccount } from "../../team/useTeam";
import { Button } from "../ui/button";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

/** Sign-in is optional, so a signed-out person only sees a quiet link and nothing is fetched. */
export function SidebarAccountItem({ onOpen }: { readonly onOpen: () => void }) {
  const { session } = useTeamAccount();
  const name = session.status === "ready" ? session.me.user.name : null;
  if (session.status === "signed-out") {
    return (
      <SidebarMenuItem className="shrink-0">
        <Button size="sm" onClick={onOpen}>
          Sign in
        </Button>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem className="min-w-0 flex-1">
      <SidebarMenuButton
        aria-label={name === null ? "Account" : `Account: ${name}`}
        onClick={onOpen}
      >
        {name === null ? null : <TeamAvatar name={name} size="sm" />}
        <span className="truncate">{name ?? "Account"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
