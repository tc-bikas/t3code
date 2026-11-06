import * as NodeCrypto from "node:crypto";

export const DAY = 24 * 60 * 60 * 1000;

export const newToken = (): string => NodeCrypto.randomBytes(32).toString("base64url");

export const sha256 = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");
