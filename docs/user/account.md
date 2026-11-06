# Account and organisations

An account is optional. Everything in T3 Code works without one. Sign in only if you want to join
an organisation (a group of people who work together) or to message other people.

Accounts and organisations live on a separate Team server, not on your T3 Code server. To run one
locally, use `vp run dev:team`.

## Sign in with GitHub

Open **Settings → Account** and choose **Sign in with GitHub**. Your browser opens GitHub; approve
the request and come back. T3 Code finishes signing in on its own. **Cancel** stops waiting.

Your name, avatar, and verified emails come from GitHub. From the same page you can change your
display name, see where you're signed in, revoke a device, sign out, or delete your account.
Deleting it removes you from every organisation.

Your **work email** is a verified email on your GitHub account. To use another one, add and verify
it on GitHub, then sign in again.

The Team server's address is under **Advanced: Team server**. Each address keeps its own sign-in,
and **Test connection** checks that it answers.

## Organisations

Open **Settings → Organisation**. If you don't belong to one yet, create it and you become its
owner. If you belong to several, pick the active one at the top of the page.

- **Owners** rename the organisation, change roles, remove anyone, and delete it.
- **Admins** invite people and remove members.
- **Members** see who's in the organisation and can leave.

Every organisation keeps at least one owner. To step down, make someone else an owner first.

## Invitations

Owners and admins invite people by email. An invitation matches any verified email on the invited
person's GitHub account, so it appears under **Invitations** on their **Settings → Organisation**
page. They choose **Accept** or **Decline**. No link is needed. Revoke a pending invitation from
the section it was sent from.

## Auto-join

Owners can turn on **Auto-join** for a work domain from their verified emails. Anyone with a
verified email at that domain joins as a member without an invitation. Public providers such as
gmail.com can't be claimed.

## Messages

Once you're signed in, **Messages** appears in the sidebar footer. It sends direct messages
between two people who have T3 Code accounts. You don't need an organisation.

Choose **New message**, search for someone by name or GitHub login (at least two characters), and
pick them. Enter sends, Shift+Enter adds a line. A message that fails to send stays in the
conversation with **Retry** and **Discard**. Paste a link to share it; links open in your browser,
and GitHub pull request links show as a compact `repo #number` chip.

When someone writes to you and you're not looking at that conversation, T3 Code notifies you the
way it does for thread updates: a toast while the app is focused, a desktop notification
otherwise. Both follow your notification settings. A number on the Messages icon counts unread
messages, and a conversation is marked read when you open it.

Deleting your account removes your conversations and messages.
