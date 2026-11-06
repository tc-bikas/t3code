import { CircleCheckIcon } from "lucide-react";
import { useState } from "react";
import type { TeamMe } from "@t3tools/contracts";

import { TeamAvatar } from "../../team/TeamAvatar";
import { TeamTextField } from "../../team/TeamFields";
import {
  DEFAULT_TEAM_SERVER_URL,
  normalizeTeamServerUrl,
  teamNameIssue,
} from "../../team/team.logic";
import { checkTeamServerHealth } from "../../team/teamClient";
import {
  useGithubSignIn,
  useTeamAccount,
  useTeamAuthConfig,
  useTeamSessions,
  useTeamTask,
} from "../../team/useTeam";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type Account = ReturnType<typeof useTeamAccount>;

export function FormError({ message }: { readonly message: string | null }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

export function AccountSettings() {
  const account = useTeamAccount();
  const { session, token } = account;
  return (
    <SettingsPageContainer>
      {session.status === "ready" && token !== null ? (
        <SignedInSections account={account} token={token} me={session.me} />
      ) : session.status === "signed-out" ? (
        <SignedOutSection account={account} />
      ) : (
        <SessionStatusSection account={account} title="Account" />
      )}
      <TeamServerSection account={account} />
    </SettingsPageContainer>
  );
}

export function SessionStatusSection({
  account,
  title,
}: {
  readonly account: Account;
  readonly title: string;
}) {
  const { session, serverUrl } = account;
  const task = useTeamTask(serverUrl);
  const problem =
    session.status === "unreachable"
      ? `Can't reach the Team server at ${serverUrl}. Check that it's running, or change the address below.`
      : session.status === "failed"
        ? session.message
        : null;
  return (
    <SettingsSection title={title}>
      {problem === null ? (
        <SettingsRow
          title="Checking your session"
          control={<Spinner size="sm" tone="muted" aria-label="Loading" />}
        />
      ) : (
        <SettingsRow
          title="Can't load your account"
          description={problem}
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={task.pending}
              onClick={() => void task.run(() => account.refreshSession())}
            >
              Try again
            </Button>
          }
        />
      )}
    </SettingsSection>
  );
}

function SignedOutSection({ account }: { readonly account: Account }) {
  const config = useTeamAuthConfig(account.serverUrl);
  const github = useGithubSignIn(account);
  const { state } = config;
  const waiting = github.state.status === "starting" || github.state.status === "waiting";

  return (
    <SettingsSection id="account-sign-in" title="Account">
      {state.status === "loading" ? (
        <SettingsRow
          title="Checking the Team server"
          control={<Spinner size="sm" tone="muted" aria-label="Loading" />}
        />
      ) : state.status === "failed" ? (
        <SettingsRow
          title="Can't reach the Team server"
          description={state.message}
          control={
            <Button size="sm" variant="outline" onClick={() => void config.reload()}>
              Try again
            </Button>
          }
        />
      ) : !state.config.githubConfigured ? (
        <SettingsRow
          title="GitHub sign-in isn't set up on this Team server yet"
          description="See docs/operations/team-service.md."
          control={
            <Button size="sm" variant="outline" onClick={() => void config.reload()}>
              Check again
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 px-3 py-4 sm:px-4">
          <p className="text-xs leading-normal text-muted-foreground">
            Signing in is optional, and lets you join an organisation.
          </p>
          {waiting ? (
            <div className="flex flex-wrap items-center gap-3">
              <Spinner size="sm" tone="muted" aria-label="Loading" />
              <p role="status" className="text-xs text-muted-foreground">
                Waiting for GitHub… finish signing in in your browser.
              </p>
              <Button size="sm" variant="outline" onClick={github.cancel}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              {github.state.status === "failed" ? (
                <FormError message={github.state.message} />
              ) : null}
              <div>
                <Button onClick={() => void github.start()}>
                  {github.state.status === "failed" ? "Try again" : "Sign in with GitHub"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function SignedInSections({
  account,
  token,
  me,
}: {
  readonly account: Account;
  readonly token: string;
  readonly me: TeamMe;
}) {
  const sessions = useTeamSessions(account.serverUrl, token);
  const [deleting, setDeleting] = useState(false);
  const signOut = useTeamTask(account.serverUrl);
  const revoke = useTeamTask(account.serverUrl);
  return (
    <>
      <SettingsSection title="Profile">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <TeamAvatar name={me.user.name} avatarUrl={me.user.avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{me.user.name}</div>
            <div className="truncate text-xs text-muted-foreground">@{me.user.githubLogin}</div>
            <div className="truncate text-xs text-muted-foreground">
              {me.user.email ?? "No verified email"}
            </div>
          </div>
        </div>
        <EditNameForm account={account} currentName={me.user.name} />
        <SettingsRow
          title="Sign out"
          description="Signs out this device only."
          status={<FormError message={signOut.error} />}
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={signOut.pending}
              onClick={() =>
                void signOut.run(
                  () => account.api.signOut().catch(() => undefined),
                  () => account.storeToken(null),
                )
              }
            >
              Sign out
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="Active sessions">
        {sessions.state.status === "ready" ? (
          sessions.state.sessions.map((entry) => (
            <SettingsRow
              key={entry.id}
              title={
                <span className="flex items-center gap-2">
                  {entry.label}
                  {entry.current ? <Badge variant="info">This device</Badge> : null}
                </span>
              }
              description={`Last used ${formatRelativeTimeLabel(entry.lastUsedAt) || "just now"}`}
              control={
                entry.current ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.pending}
                    onClick={() =>
                      void revoke.run(
                        () => account.api.revokeSession(entry.id),
                        () => void sessions.reload(),
                      )
                    }
                  >
                    Revoke
                  </Button>
                )
              }
            />
          ))
        ) : sessions.state.status === "failed" ? (
          <SettingsRow
            title="Couldn't load your sessions"
            description={sessions.state.message}
            control={
              <Button size="sm" variant="outline" onClick={() => void sessions.reload()}>
                Try again
              </Button>
            }
          />
        ) : (
          <SettingsRow
            title="Loading sessions"
            control={<Spinner size="sm" tone="muted" aria-label="Loading" />}
          />
        )}
        {revoke.error ? (
          <div className="px-3 py-2 sm:px-4">
            <FormError message={revoke.error} />
          </div>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Danger zone">
        <SettingsRow
          title="Delete account"
          description="Permanently deletes your account and removes you from every organisation. If you're the only owner of an organisation, hand over ownership or delete it first."
          control={
            <Button size="sm" variant="destructive-outline" onClick={() => setDeleting(true)}>
              Delete account
            </Button>
          }
        />
      </SettingsSection>
      {deleting ? (
        <DeleteAccountDialog account={account} onClose={() => setDeleting(false)} />
      ) : null}
    </>
  );
}

function EditNameForm({
  account,
  currentName,
}: {
  readonly account: Account;
  readonly currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const [submitted, setSubmitted] = useState(false);
  const task = useTeamTask(account.serverUrl);
  const issue = teamNameIssue(name);
  const unchanged = name.trim() === currentName;
  return (
    <form
      className="grid gap-3 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (issue || unchanged) return;
        void task.run(
          () => account.api.updateProfile({ name: name.trim() }),
          () => void account.refreshSession(),
        );
      }}
    >
      <TeamTextField
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoComplete="name"
        error={submitted ? issue : null}
      />
      <FormError message={task.error} />
      <div>
        <Button type="submit" size="sm" disabled={task.pending || unchanged}>
          Save name
        </Button>
      </div>
    </form>
  );
}

function DeleteAccountDialog({
  account,
  onClose,
}: {
  readonly account: Account;
  readonly onClose: () => void;
}) {
  const task = useTeamTask(account.serverUrl);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This can't be undone. It removes you from every organisation you belong to.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <FormError message={task.error} />
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={task.pending}
            onClick={() =>
              void task.run(
                () => account.api.deleteAccount(),
                () => {
                  account.storeToken(null);
                  onClose();
                },
              )
            }
          >
            Delete account
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function TeamServerSection({ account }: { readonly account: Account }) {
  const [draft, setDraft] = useState(account.serverUrl);
  const [tested, setTested] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const task = useTeamTask(account.serverUrl);
  const normalized = normalizeTeamServerUrl(draft);
  const changed = normalized !== null && normalized !== account.serverUrl;

  const validate = () => {
    setTested(null);
    task.clearError();
    if (normalized === null) {
      setIssue("Enter a full http:// or https:// address.");
      return null;
    }
    setIssue(null);
    return normalized;
  };

  return (
    <FoldedSettingsSection
      id="team-server"
      title="Advanced: Team server"
      summary={account.serverUrl}
    >
      <form
        className="grid gap-3 px-3 py-3 sm:px-4"
        onSubmit={(event) => {
          event.preventDefault();
          const url = validate();
          if (url === null) return;
          account.setServerUrl(url);
          setDraft(url);
        }}
      >
        <TeamTextField
          label="Server address"
          hint="Where accounts and organisations live. Each address keeps its own sign-in."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          error={issue}
        />
        <FormError message={task.error} />
        {tested ? (
          <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheckIcon className="size-3.5 text-success" />
            Connected to {tested}.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!changed}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={task.pending}
            onClick={() => {
              const url = validate();
              if (url === null) return;
              void task.run(
                () => checkTeamServerHealth(url),
                () => setTested(url),
              );
            }}
          >
            Test connection
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost-muted"
            disabled={draft === DEFAULT_TEAM_SERVER_URL && account.serverUrl === draft}
            onClick={() => {
              setDraft(DEFAULT_TEAM_SERVER_URL);
              account.setServerUrl(DEFAULT_TEAM_SERVER_URL);
              setIssue(null);
              setTested(null);
              task.clearError();
            }}
          >
            Reset to default
          </Button>
        </div>
      </form>
    </FoldedSettingsSection>
  );
}
