export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailSender {
  /** A console sender prints mail instead of sending it; only then do responses carry `devLink`. */
  readonly console: boolean;
  send(mail: Mail): Promise<void>;
}

export function createConsoleSender(): EmailSender {
  return {
    console: true,
    async send(mail) {
      console.log(`\n--- mail to ${mail.to}: ${mail.subject}\n${mail.text}\n---\n`);
    },
  };
}

export function createResendSender(apiKey: string, from: string): EmailSender {
  return {
    console: false,
    async send(mail) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!response.ok) throw new Error(`Resend responded ${response.status}`);
    },
  };
}

export const verifyMail = (to: string, link: string): Mail => ({
  to,
  subject: "Confirm your email for T3 Code Team",
  text: `Confirm this email address for your T3 Code Team account:\n\n${link}\n\nThe link works once and expires in 24 hours. If you did not create an account, ignore this email.`,
});

export const resetMail = (to: string, link: string): Mail => ({
  to,
  subject: "Reset your T3 Code Team password",
  text: `Open this link to choose a new password:\n\n${link}\n\nThe link works once and expires in 1 hour. If you did not ask for this, ignore this email; your password has not changed.`,
});

export const inviteMail = (
  to: string,
  organization: string,
  inviter: string,
  role: string,
): Mail => ({
  to,
  subject: `${inviter} invited you to ${organization} on T3 Code`,
  text: `${inviter} invited you to join ${organization} as ${role === "admin" ? "an admin" : "a member"}.\n\nOpen the T3 Code app and look under Settings > Organisation to accept. Sign up with this email address first if you do not have an account.\n\nThe invitation expires in 14 days.`,
});
