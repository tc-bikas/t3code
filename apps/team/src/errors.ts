import type { TeamErrorCode } from "@t3tools/contracts";

export const TEAM_ERROR_STATUS: Record<TeamErrorCode, number> = {
  "invalid-input": 400,
  unauthorized: 401,
  forbidden: 403,
  "not-found": 404,
  "not-configured": 503,
  "rate-limited": 429,
  "not-allowed": 403,
  "domain-not-allowed": 400,
  "last-owner": 409,
  "already-member": 409,
  "invite-expired": 410,
  unavailable: 503,
};

export class TeamError extends Error {
  readonly code: TeamErrorCode;
  constructor(code: TeamErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
