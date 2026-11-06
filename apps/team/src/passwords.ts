import * as NodeCrypto from "node:crypto";
import { TeamError } from "./errors.ts";

const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    NodeCrypto.scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = NodeCrypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"));
  return expected.length === actual.length && NodeCrypto.timingSafeEqual(expected, actual);
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so an unknown email is not faster to reject. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
  return false;
}

// Only entries of the minimum length (10) or more can matter.
const COMMON_PASSWORDS = new Set([
  "1234567890",
  "0123456789",
  "9876543210",
  "12345678910",
  "123456789a",
  "1q2w3e4r5t",
  "1qaz2wsx3edc",
  "qwertyuiop",
  "qwerty1234",
  "qwerty12345",
  "qwerty123456",
  "asdfghjkl1",
  "asdfghjkl123",
  "qazwsxedcrfv",
  "zxcvbnm123",
  "password12",
  "password123",
  "password1234",
  "password12345",
  "passw0rd123",
  "passwordpassword",
  "iloveyou123",
  "iloveyou12",
  "letmein123",
  "welcome123",
  "welcome1234",
  "administrator",
  "changeme123",
  "trustno1234",
  "superman123",
  "football123",
  "baseball123",
  "monkey12345",
  "dragon12345",
  "princess123",
  "abcdefghij",
  "abcd123456",
  "1111111111",
  "0000000000",
  "123123123123",
]);

export function assertStrongPassword(password: string, email: string): void {
  const lowered = password.toLowerCase();
  const localPart = email.split("@")[0] ?? "";
  if (
    lowered === email ||
    lowered === localPart ||
    COMMON_PASSWORDS.has(lowered) ||
    new Set(lowered).size < 3
  ) {
    throw new TeamError("weak-password", "Choose a password that is harder to guess.");
  }
}
