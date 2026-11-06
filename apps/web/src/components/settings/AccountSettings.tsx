import { CircleCheckIcon } from "lucide-react";
import { useState } from "react";
import type { TeamMe } from "@t3tools/contracts";

import { DevMailLink } from "../../team/DevMailLink";
import { TeamPasswordField, TeamTextField } from "../../team/TeamFields";
import { TeamAvatar } from "../../team/TeamAvatar";
import {
  DEFAULT_TEAM_SERVER_URL,
  normalizeTeamServerUrl,
  teamEmailIssue,
  teamNameIssue,
  teamPasswordIssue,
  TEAM_PASSWORD_MIN_LENGTH,
} from "../../team/team.logic";
import { checkTeamServerHealth } from "../../team/teamClient";
import { useTeamAccount, useTeamSessions, useTeamTask } from "../../team/useTeam";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
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
  const [devLink, setDevLink] = useState<string | null>(null);
  const { session, token } = account;
  return (
    <SettingsPageContainer>
      {session.status === "ready" && token !== null ? (
        <SignedInSections
          account={account}
          token={token}
          me={session.me}
          devLink={devLink}
          setDevLink={setDevLink}
        />
      ) : session.status === "signed-out" ? (
        <SignedOutSection account={account} setDevLink={setDevLink} />
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

type AuthMode = "sign-in" | "sign-up";

function SignedOutSection({
  account,
  setDevLink,
}: {
  readonly account: Account;
  readonly setDevLink: (link: string | null) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [resetSent, setResetSent] = useState<{ email: string; devLink?: string } | null>(null);
  const task = useTeamTask(account.serverUrl);

  const emailIssue = teamEmailIssue(email);
  const nameIssue = mode === "sign-up" ? teamNameIssue(name) : null;
  const passwordIssue =
    mode === "sign-up"
      ? teamPasswordIssue(password)
      : password === ""
        ? "Enter your password."
        : null;
  const signUp = mode === "sign-up";

  const submit = () => {
    setSubmitted(true);
    if (emailIssue || nameIssue || passwordIssue) return;
    const base = { email: email.trim(), password, deviceLabel: account.deviceLabel };
    void task.run(
      () =>
        signUp ? account.api.signUp({ ...base, name: name.trim() }) : account.api.signIn(base),
      (result) => {
        setDevLink(result.devLink ?? null);
        account.storeToken(result.token);
      },
    );
  };

  const forgotPassword = () => {
    setSubmitted(true);
    if (emailIssue) return;
    void task.run(
      () => account.api.forgotPassword(email.trim()),
      (result) =>
        setResetSent({
          email: email.trim(),
          ...(result.devLink === undefined ? {} : { devLink: result.devLink }),
        }),
    );
  };

  return (
    <SettingsSection id="account-sign-in" title="Account">
      <div className="grid gap-4 px-3 py-4 sm:px-4">
        <p className="text-xs leading-normal text-muted-foreground">
          Signing in is optional. Everything in T3 Code works without it. An account lets you join
          an organisation.
        </p>
        <ToggleGroup
          aria-label="Sign in or create an account"
          variant="segmented"
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "sign-in" || value === "sign-up") {
              setMode(value);
              setSubmitted(false);
              setResetSent(null);
              task.clearError();
            }
          }}
        >
          <Toggle value="sign-in">Sign in</Toggle>
          <Toggle value="sign-up">Create account</Toggle>
        </ToggleGroup>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {signUp ? (
            <TeamTextField
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              error={submitted ? nameIssue : null}
            />
          ) : null}
          <TeamTextField
            label={signUp ? "Work email" : "Email"}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            spellCheck={false}
            error={submitted ? emailIssue : null}
          />
          <TeamPasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={signUp ? "new-password" : "current-password"}
            hint={signUp ? `At least ${TEAM_PASSWORD_MIN_LENGTH} characters.` : undefined}
            error={submitted ? passwordIssue : null}
          />
          <FormError message={task.error} />
          <div className="flex items-center justify-between gap-3">
            <Button type="submit" disabled={task.pending}>
              {signUp ? "Create account" : "Sign in"}
            </Button>
            {signUp ? null : (
              <Button
                type="button"
                variant="ghost-muted"
                size="sm"
                disabled={task.pending}
                onClick={forgotPassword}
              >
                Forgot password?
              </Button>
            )}
          </div>
        </form>
        {resetSent ? (
          <div className="grid gap-2">
            <p role="status" className="text-xs text-muted-foreground">
              If an account exists for {resetSent.email}, we've sent a link to reset the password.
            </p>
            {resetSent.devLink ? (
              <DevMailLink devLink={resetSent.devLink} label="Open reset link" />
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function SignedInSections({
  account,
  token,
  me,
  devLink,
  setDevLink,
}: {
  readonly account: Account;
  readonly token: string;
  readonly me: TeamMe;
  readonly devLink: string | null;
  readonly setDevLink: (link: string | null) => void;
}) {
  const sessions = useTeamSessions(account.serverUrl, token);
  const [deleting, setDeleting] = useState(false);
  const signOut = useTeamTask(account.serverUrl);
  const revoke = useTeamTask(account.serverUrl);
  return (
    <>
      {me.user.emailVerified ? null : (
        <VerifyEmailBanner account={account} me={me} devLink={devLink} setDevLink={setDevLink} />
      )}
      <SettingsSection title="Profile">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <TeamAvatar name={me.user.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{me.user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{me.user.email}</div>
          </div>
          <Badge variant={me.user.emailVerified ? "success" : "warning"}>
            {me.user.emailVerified ? "Verified" : "Not verified"}
          </Badge>
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
      <SettingsSection title="Password">
        <ChangePasswordForm account={account} onChanged={() => void sessions.reload()} />
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

function VerifyEmailBanner({
  account,
  me,
  devLink,
  setDevLink,
}: {
  readonly account: Account;
  readonly me: TeamMe;
  readonly devLink: string | null;
  readonly setDevLink: (link: string | null) => void;
}) {
  const [sent, setSent] = useState(false);
  const resend = useTeamTask(account.serverUrl);
  const refresh = useTeamTask(account.serverUrl);
  return (
    <div className="grid gap-2">
      <Alert variant="warning" controlAlignment="first-line">
        <AlertTitle>Verify your email</AlertTitle>
        <AlertDescription>
          Confirm {me.user.email} to join or create an organisation. Open the link in the email we
          sent, then come back here.
        </AlertDescription>
        <AlertAction>
          <Button
            size="xs"
            variant="outline"
            disabled={resend.pending}
            onClick={() =>
              void resend.run(
                () => account.api.resendVerification(),
                (result) => {
                  setDevLink(result.devLink ?? null);
                  setSent(true);
                },
              )
            }
          >
            Resend email
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={refresh.pending}
            onClick={() => void refresh.run(() => account.refreshSession())}
          >
            I've verified, refresh
          </Button>
        </AlertAction>
      </Alert>
      {sent && devLink === null ? (
        <p role="status" className="px-1 text-xs text-muted-foreground">
          Verification email sent to {me.user.email}.
        </p>
      ) : null}
      {devLink ? <DevMailLink devLink={devLink} label="Open verification link" /> : null}
      <FormError message={resend.error ?? refresh.error} />
    </div>
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

function ChangePasswordForm({
  account,
  onChanged,
}: {
  readonly account: Account;
  readonly onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);
  const task = useTeamTask(account.serverUrl);
  const currentIssue = current === "" ? "Enter your current password." : null;
  const nextIssue = teamPasswordIssue(next);
  return (
    <form
      className="grid gap-3 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        setDone(false);
        if (currentIssue || nextIssue) return;
        void task.run(
          () => account.api.changePassword({ currentPassword: current, newPassword: next }),
          () => {
            setCurrent("");
            setNext("");
            setSubmitted(false);
            setDone(true);
            onChanged();
          },
        );
      }}
    >
      <TeamPasswordField
        label="Current password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        autoComplete="current-password"
        error={submitted ? currentIssue : null}
      />
      <TeamPasswordField
        label="New password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        autoComplete="new-password"
        hint={`At least ${TEAM_PASSWORD_MIN_LENGTH} characters. Your other devices are signed out.`}
        error={submitted ? nextIssue : null}
      />
      <FormError message={task.error} />
      {done ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleCheckIcon className="size-3.5 text-success" />
          Password changed. Your other devices were signed out.
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={task.pending}>
          Change password
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
  const [password, setPassword] = useState("");
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
            This can't be undone. Enter your password to confirm.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="delete-account-form"
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (password === "") return;
              void task.run(
                () => account.api.deleteAccount({ password }),
                () => {
                  account.storeToken(null);
                  onClose();
                },
              );
            }}
          >
            <TeamPasswordField
              label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <FormError message={task.error} />
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="delete-account-form"
            variant="destructive"
            disabled={task.pending || password === ""}
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
