import { Link } from "@tanstack/react-router";
import type {
  TeamInvitation,
  TeamMe,
  TeamMember,
  TeamOrganizationDetail,
  TeamRole,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { TeamTextField } from "../../team/TeamFields";
import {
  autoJoinEligibility,
  canChangeMemberRole,
  canRemoveMember,
  organizationDeleteConfirmed,
  organizationPermissions,
  teamEmailIssue,
} from "../../team/team.logic";
import {
  useActiveTeamMembership,
  usePublishTeamOrganization,
  useTeamAccount,
  useTeamOrganization,
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
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { FormError, SessionStatusSection } from "./AccountSettings";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type Account = ReturnType<typeof useTeamAccount>;

const ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
const ROLE_BADGE_VARIANTS = { owner: "default", admin: "info", member: "secondary" } as const;

function RoleBadge({ role }: { readonly role: TeamRole }) {
  return <Badge variant={ROLE_BADGE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>;
}

function RoleSelect({
  value,
  roles,
  label,
  disabled,
  onChange,
}: {
  readonly value: TeamRole;
  readonly roles: ReadonlyArray<TeamRole>;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (role: TeamRole) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const role = roles.find((candidate) => candidate === next);
        if (role) onChange(role);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-32 min-w-0">
        <SelectValue>{() => ROLE_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function OrganisationSettings() {
  const account = useTeamAccount();
  const { session } = account;

  if (session.status === "ready") {
    return session.me.user.emailVerified ? (
      <OrganisationHome account={account} me={session.me} />
    ) : (
      <SettingsPageContainer>
        <SettingsSection title="Organisation">
          <SettingsRow
            title="Verify your email first"
            description="Organisations are tied to a verified email, so invitations and auto-join can find you. Open the link in the email we sent, then refresh on the Account page."
            control={
              <Button size="sm" render={<Link to="/settings/account" />}>
                Go to Account
              </Button>
            }
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      {session.status === "signed-out" ? (
        <SettingsSection title="Organisation">
          <SettingsRow
            title="Sign in to use organisations"
            description="An organisation brings your team together under one account. Signing in is optional, and the rest of T3 Code works without it."
            control={
              <Button size="sm" render={<Link to="/settings/account" />}>
                Go to Account
              </Button>
            }
          />
        </SettingsSection>
      ) : (
        <SessionStatusSection account={account} title="Organisation" />
      )}
    </SettingsPageContainer>
  );
}

function OrganisationHome({ account, me }: { readonly account: Account; readonly me: TeamMe }) {
  const { active, select } = useActiveTeamMembership(me.memberships);
  const token = account.token;
  return (
    <SettingsPageContainer>
      {me.invitations.length > 0 ? (
        <InvitationsSection
          account={account}
          token={token}
          invitations={me.invitations}
          select={select}
        />
      ) : null}
      {active !== null && token !== null ? (
        <>
          <ActiveOrganization
            key={active.organization.id}
            account={account}
            token={token}
            me={me}
            organizationId={active.organization.id}
            switcher={
              me.memberships.length > 1 ? (
                <Select
                  value={active.organization.id}
                  onValueChange={(next) => {
                    if (next !== null) select(next);
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Active organisation" className="w-48">
                    <SelectValue>{() => active.organization.name}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {me.memberships.map((membership) => (
                      <SelectItem
                        key={membership.organization.id}
                        value={membership.organization.id}
                      >
                        {membership.organization.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null
            }
          />
          <FoldedSettingsSection id="new-organisation" title="Create another organisation">
            <CreateOrganizationForm account={account} token={token} select={select} />
          </FoldedSettingsSection>
        </>
      ) : (
        <SettingsSection title="Create an organisation">
          {token === null ? null : (
            <CreateOrganizationForm account={account} token={token} select={select} />
          )}
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function CreateOrganizationForm({
  account,
  token,
  select,
}: {
  readonly account: Account;
  readonly token: string;
  readonly select: (organizationId: string) => void;
}) {
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const task = useTeamTask(account.serverUrl);
  const issue =
    name.trim() === ""
      ? "Enter a name."
      : name.trim().length > 80
        ? "Use 80 characters or fewer."
        : null;
  const publish = usePublishTeamOrganization(account.serverUrl, token);
  return (
    <form
      className="grid gap-3 px-3 py-4 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (issue) return;
        void task.run(
          () => account.api.createOrganization({ name: name.trim() }),
          (detail) => {
            publish(detail);
            select(detail.organization.id);
            setName("");
            setSubmitted(false);
            void account.refreshSession();
          },
        );
      }}
    >
      <TeamTextField
        label="Organisation name"
        hint="You become its owner and can invite your team afterwards."
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        error={submitted ? issue : null}
      />
      <FormError message={task.error} />
      <div>
        <Button type="submit" disabled={task.pending}>
          Create organisation
        </Button>
      </div>
    </form>
  );
}

function InvitationsSection({
  account,
  token,
  invitations,
  select,
}: {
  readonly account: Account;
  readonly token: string | null;
  readonly invitations: ReadonlyArray<TeamInvitation>;
  readonly select: (organizationId: string) => void;
}) {
  const task = useTeamTask(account.serverUrl);
  return (
    <SettingsSection title="Invitations">
      {invitations.map((invitation) => (
        <SettingsRow
          key={invitation.id}
          title={invitation.organizationName}
          description={`${invitation.invitedByName} invited you as ${ROLE_LABELS[invitation.role].toLowerCase()} ${formatRelativeTimeLabel(invitation.createdAt)}.`}
          control={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={task.pending}
                onClick={() =>
                  void task.run(
                    () => account.api.declineInvitation(invitation.id),
                    () => void account.refreshSession(),
                  )
                }
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={task.pending || token === null}
                onClick={() =>
                  void task.run(
                    () => account.api.acceptInvitation(invitation.id),
                    (detail) => {
                      select(detail.organization.id);
                      void account.refreshSession();
                    },
                  )
                }
              >
                Accept
              </Button>
            </>
          }
        />
      ))}
      {task.error ? (
        <div className="px-3 py-2 sm:px-4">
          <FormError message={task.error} />
        </div>
      ) : null}
    </SettingsSection>
  );
}

function ActiveOrganization({
  account,
  token,
  me,
  organizationId,
  switcher,
}: {
  readonly account: Account;
  readonly token: string;
  readonly me: TeamMe;
  readonly organizationId: string;
  readonly switcher: ReactNode;
}) {
  const organization = useTeamOrganization(organizationId, account.serverUrl, token);
  const { state } = organization;

  if (state.status !== "ready") {
    return (
      <SettingsSection title="Organisation" headerAction={switcher}>
        {state.status === "loading" ? (
          <SettingsRow
            title="Loading organisation"
            control={<Spinner size="sm" tone="muted" aria-label="Loading" />}
          />
        ) : (
          <SettingsRow
            title="Can't load this organisation"
            description={state.error.message}
            control={
              <Button size="sm" variant="outline" onClick={() => void organization.reload()}>
                Try again
              </Button>
            }
          />
        )}
      </SettingsSection>
    );
  }

  return (
    <OrganisationDetail
      account={account}
      me={me}
      detail={state.detail}
      switcher={switcher}
      onChanged={(next) => {
        if (next) organization.publish(next);
        else void organization.reload();
        void account.refreshSession();
      }}
    />
  );
}

function OrganisationDetail({
  account,
  me,
  detail,
  switcher,
  onChanged,
}: {
  readonly account: Account;
  readonly me: TeamMe;
  readonly detail: TeamOrganizationDetail;
  readonly switcher: ReactNode;
  /** Pass the fresh detail when the call returned one, otherwise the page re-reads it. */
  readonly onChanged: (detail?: TeamOrganizationDetail) => void;
}) {
  const { organization, role, members, invites } = detail;
  const permissions = organizationPermissions(role);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const memberTask = useTeamTask(account.serverUrl);
  const inviteTask = useTeamTask(account.serverUrl);
  const autoJoinTask = useTeamTask(account.serverUrl);
  const autoJoin = autoJoinEligibility(me.user);
  const autoJoinOn = organization.autoJoinDomain !== null;

  return (
    <>
      <SettingsSection title={organization.name} headerAction={switcher}>
        {permissions.canRename ? (
          <RenameForm
            account={account}
            name={organization.name}
            id={organization.id}
            onChanged={onChanged}
          />
        ) : null}
        <SettingsRow
          title="Your role"
          description={`${organization.memberCount} ${organization.memberCount === 1 ? "member" : "members"}`}
          control={<RoleBadge role={role} />}
        />
        {permissions.canManageAutoJoin || autoJoinOn ? (
          <SettingsRow
            id="organisation-auto-join"
            title="Auto-join"
            description={
              autoJoinOn
                ? `Anyone who verifies an @${organization.autoJoinDomain} email joins as a member.`
                : autoJoin.eligible
                  ? `Let anyone who verifies an @${autoJoin.domain} email join as a member, without an invitation.`
                  : autoJoin.reason
            }
            status={<FormError message={autoJoinTask.error} />}
            control={
              permissions.canManageAutoJoin ? (
                <Switch
                  checked={autoJoinOn}
                  disabled={autoJoinTask.pending || (!autoJoinOn && !autoJoin.eligible)}
                  aria-label="Auto-join"
                  onCheckedChange={(checked) =>
                    void autoJoinTask.run(
                      () =>
                        account.api.updateOrganization(organization.id, {
                          autoJoinDomain: checked && autoJoin.eligible ? autoJoin.domain : null,
                        }),
                      onChanged,
                    )
                  }
                />
              ) : null
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Members">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                isYou={member.userId === me.user.id}
                canChangeRole={canChangeMemberRole(role, me.user.id, member)}
                canRemove={canRemoveMember(role, me.user.id, member)}
                pending={memberTask.pending}
                onChangeRole={(next) =>
                  void memberTask.run(
                    () => account.api.setMemberRole(organization.id, member.userId, next),
                    onChanged,
                  )
                }
                onRemove={() =>
                  void memberTask.run(
                    () => account.api.removeMember(organization.id, member.userId),
                    () => onChanged(),
                  )
                }
              />
            ))}
          </TableBody>
        </Table>
        {memberTask.error ? (
          <div className="px-3 py-2 sm:px-4">
            <FormError message={memberTask.error} />
          </div>
        ) : null}
      </SettingsSection>

      {permissions.canInvite ? (
        <SettingsSection title="Invite people">
          <InviteForm
            account={account}
            organizationId={organization.id}
            task={inviteTask}
            onInvited={() => onChanged()}
          />
          {invites.map((invite) => (
            <SettingsRow
              key={invite.id}
              title={
                <span className="flex items-center gap-2">
                  {invite.email}
                  <RoleBadge role={invite.role} />
                </span>
              }
              description={`Invited ${formatRelativeTimeLabel(invite.createdAt)} by ${invite.invitedByName}. They join once they verify this email.`}
              control={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={inviteTask.pending}
                  onClick={() =>
                    void inviteTask.run(
                      () => account.api.revokeInvite(organization.id, invite.id),
                      () => onChanged(),
                    )
                  }
                >
                  Revoke
                </Button>
              }
            />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection title="Danger zone">
        <SettingsRow
          title="Leave organisation"
          description="You lose access to this organisation. An admin can invite you back."
          control={
            <Button size="sm" variant="destructive-outline" onClick={() => setLeaving(true)}>
              Leave
            </Button>
          }
        />
        {permissions.canDelete ? (
          <SettingsRow
            title="Delete organisation"
            description="Removes the organisation, its members, and pending invitations for everyone."
            control={
              <Button size="sm" variant="destructive-outline" onClick={() => setDeleting(true)}>
                Delete organisation
              </Button>
            }
          />
        ) : null}
      </SettingsSection>

      {leaving ? (
        <ConfirmDialog
          account={account}
          title={`Leave ${organization.name}?`}
          description="You'll lose access to this organisation until someone invites you again."
          confirmLabel="Leave organisation"
          onClose={() => setLeaving(false)}
          onConfirm={() => account.api.removeMember(organization.id, me.user.id)}
          onDone={() => void account.refreshSession()}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          account={account}
          title={`Delete ${organization.name}?`}
          description="This removes the organisation for every member and can't be undone."
          confirmLabel="Delete organisation"
          requiredText={organization.name}
          onClose={() => setDeleting(false)}
          onConfirm={() => account.api.deleteOrganization(organization.id)}
          onDone={() => void account.refreshSession()}
        />
      ) : null}
    </>
  );
}

function RenameForm({
  account,
  id,
  name,
  onChanged,
}: {
  readonly account: Account;
  readonly id: string;
  readonly name: string;
  readonly onChanged: (detail?: TeamOrganizationDetail) => void;
}) {
  const [draft, setDraft] = useState(name);
  const task = useTeamTask(account.serverUrl);
  const trimmed = draft.trim();
  const invalid = trimmed === "" || trimmed.length > 80;
  return (
    <form
      className="grid gap-3 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || trimmed === name) return;
        void task.run(() => account.api.updateOrganization(id, { name: trimmed }), onChanged);
      }}
    >
      <TeamTextField
        label="Name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={80}
      />
      <FormError message={task.error} />
      <div>
        <Button type="submit" size="sm" disabled={task.pending || invalid || trimmed === name}>
          Save name
        </Button>
      </div>
    </form>
  );
}

function MemberRow({
  member,
  isYou,
  canChangeRole,
  canRemove,
  pending,
  onChangeRole,
  onRemove,
}: {
  readonly member: TeamMember;
  readonly isYou: boolean;
  readonly canChangeRole: boolean;
  readonly canRemove: boolean;
  readonly pending: boolean;
  readonly onChangeRole: (role: TeamRole) => void;
  readonly onRemove: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{member.name}</span>
          {isYou ? <Badge variant="outline">You</Badge> : null}
        </span>
      </TableCell>
      <TableCell>
        <span className="text-muted-foreground">{member.email}</span>
      </TableCell>
      <TableCell>
        {canChangeRole ? (
          <RoleSelect
            value={member.role}
            roles={["owner", "admin", "member"]}
            label={`Role of ${member.name}`}
            disabled={pending}
            onChange={onChangeRole}
          />
        ) : (
          <RoleBadge role={member.role} />
        )}
      </TableCell>
      <TableCell>
        {canRemove ? (
          <Button
            size="xs"
            variant="ghost-destructive"
            disabled={pending}
            aria-label={`Remove ${member.name}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function InviteForm({
  account,
  organizationId,
  task,
  onInvited,
}: {
  readonly account: Account;
  readonly organizationId: string;
  readonly task: ReturnType<typeof useTeamTask>;
  readonly onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [submitted, setSubmitted] = useState(false);
  const issue = teamEmailIssue(email);
  return (
    <form
      className="grid gap-3 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (issue) return;
        const inviteRole = role === "admin" ? "admin" : "member";
        void task.run(
          () => account.api.invite(organizationId, { email: email.trim(), role: inviteRole }),
          () => {
            setEmail("");
            setSubmitted(false);
            onInvited();
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <TeamTextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          spellCheck={false}
          error={submitted ? issue : null}
        />
        <RoleSelect
          value={role}
          roles={["member", "admin"]}
          label="Role for the invited person"
          onChange={setRole}
        />
      </div>
      <FormError message={task.error} />
      <div>
        <Button type="submit" size="sm" disabled={task.pending}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

function ConfirmDialog({
  account,
  title,
  description,
  confirmLabel,
  requiredText,
  onClose,
  onConfirm,
  onDone,
}: {
  readonly account: Account;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  /** When set, the person must type it before the action unlocks. */
  readonly requiredText?: string;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<unknown>;
  readonly onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const task = useTeamTask(account.serverUrl);
  const unlocked = requiredText === undefined || organizationDeleteConfirmed(typed, requiredText);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-3">
            {requiredText === undefined ? null : (
              <div className="grid gap-1.5">
                <label htmlFor="confirm-organisation-name" className="text-xs font-medium">
                  Type <span className="font-mono">{requiredText}</span> to confirm
                </label>
                <Input
                  id="confirm-organisation-name"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </div>
            )}
            <FormError message={task.error} />
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={task.pending || !unlocked}
            onClick={() =>
              void task.run(onConfirm, () => {
                onDone();
                onClose();
              })
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
