import type { TeamPerson } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { publishConversation } from "../../team/messagesStore";
import { TeamAvatar } from "../../team/TeamAvatar";
import { isTeamError } from "../../team/teamClient";
import { useTeamMessages } from "../../team/useTeamMessages";
import { Command, CommandInput, CommandItem, CommandList, CommandListHeading } from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 50;

type SearchState =
  | { readonly phase: "idle" }
  | { readonly phase: "searching" }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "done" };

function Note({ children }: { readonly children: string }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

export function NewMessageDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { scope, api, serverUrl } = useTeamMessages();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  const [people, setPeople] = useState<ReadonlyArray<TeamPerson>>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const latestSearch = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const failure = (error: unknown) =>
    isTeamError(error) ? error.message : `Something went wrong talking to ${serverUrl}.`;

  const runSearch = async (text: string) => {
    const requestId = ++latestSearch.current;
    setSearch({ phase: "searching" });
    const result = await api.searchUsers(text).then(
      (found) => found.users,
      (error: unknown) => failure(error),
    );
    // A newer search, or closing the dialog, owns the list by now.
    if (requestId !== latestSearch.current) return;
    if (typeof result === "string") {
      setSearch({ phase: "failed", message: result });
      return;
    }
    setPeople(result);
    setSearch({ phase: "done" });
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    setStartError(null);
    clearTimeout(searchTimer.current);
    const text = value.trim().slice(0, MAX_QUERY_LENGTH);
    if (text.length < MIN_QUERY_LENGTH) {
      latestSearch.current += 1;
      setPeople([]);
      setSearch({ phase: "idle" });
      return;
    }
    searchTimer.current = setTimeout(() => void runSearch(text), SEARCH_DEBOUNCE_MS);
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) return;
    clearTimeout(searchTimer.current);
    latestSearch.current += 1;
    setQuery("");
    setSearch({ phase: "idle" });
    setPeople([]);
    setStarting(false);
    setStartError(null);
  };

  const pick = async (person: TeamPerson) => {
    if (scope === null || starting) return;
    setStarting(true);
    setStartError(null);
    const result = await api.startConversation(person.id).then(
      (conversation) => conversation,
      (error: unknown) => failure(error),
    );
    if (typeof result === "string") {
      setStarting(false);
      setStartError(result);
      return;
    }
    publishConversation(scope, result);
    handleOpenChange(false);
    void navigate({ to: "/messages/$conversationId", params: { conversationId: result.id } });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">New message</DialogTitle>
        <Command mode="none" value={query} onValueChange={changeQuery} aria-label="New message">
          <CommandInput placeholder="Search people by name or GitHub login…" />
          <CommandList>
            <CommandListHeading>People</CommandListHeading>
            {search.phase === "idle" ? <Note>Type at least 2 characters to search.</Note> : null}
            {search.phase === "searching" && people.length === 0 ? <Note>Searching…</Note> : null}
            {search.phase === "failed" ? <Note>{search.message}</Note> : null}
            {search.phase === "done" && people.length === 0 ? <Note>No one found.</Note> : null}
            {startError === null ? null : <Note>{startError}</Note>}
            {people.map((person) => (
              <CommandItem
                key={person.id}
                value={person.id}
                disabled={starting}
                onClick={() => void pick(person)}
              >
                <TeamAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  @{person.githubLogin}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogPopup>
    </Dialog>
  );
}
