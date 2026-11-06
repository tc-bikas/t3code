/** Shared mailbox providers: owning an address there says nothing about an employer. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.com",
]);

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const emailDomain = (email: string): string => email.slice(email.lastIndexOf("@") + 1);

export const isPublicEmailDomain = (domain: string): boolean => PUBLIC_EMAIL_DOMAINS.has(domain);

export const isValidDomain = (domain: string): boolean => DOMAIN_PATTERN.test(domain);
