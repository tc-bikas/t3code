# Account and organisations

An account is optional. Everything in T3 Code works without one. Sign in only if you want to join
an organisation: a group of people who work together.

Accounts and organisations live on a separate Team server, not on your T3 Code server. To run one
locally, use `vp run dev:team`.

## Sign in or create an account

Open **Settings → Account**. Choose **Create account** and enter your work email, your name, and a
password, or choose **Sign in** if you already have one. **Forgot password?** emails you a reset
link.

Verify your email after you sign up. Open the link in the email, then return to **Settings →
Account** and choose **I've verified, refresh**. Organisations need a verified email. When the Team
server has no email provider (local development), the page shows an **Open link** button instead of
sending a message.

From the same page you can change your name or password, see where you're signed in, revoke a
device, sign out, or delete your account. Changing your password signs out your other devices.

The Team server's address is under **Advanced: Team server**. Each address keeps its own sign-in, and
**Test connection** checks that it answers.

## Organisations

Open **Settings → Organisation**. If you don't belong to one yet, create it and you become its
owner. If you belong to several, pick the active one at the top of the page.

- **Owners** rename the organisation, change roles, remove anyone, and delete it.
- **Admins** invite people and remove members.
- **Members** see who's in the organisation and can leave.

Every organisation keeps at least one owner. To step down, make someone else an owner first.

## Invitations

Owners and admins invite people by email. An invitation is matched to the invited person's verified
email, so it appears under **Invitations** on their **Settings → Organisation** page. They choose
**Accept** or **Decline**. No link is needed. Revoke a pending invitation from the same section it
was sent from.

## Auto-join

Owners can turn on **Auto-join** so anyone who verifies an email at the owner's own work domain joins
as a member without an invitation. Public email providers such as gmail.com can't be claimed, so
sign in with a work email to use it.
