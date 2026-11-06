import { TeamError } from "./errors.ts";

const HOUR = 60 * 60 * 1000;
const SWEEP_THRESHOLD = 10_000;

export const LOGIN_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };
export const SIGNUP_LIMIT = { limit: 10, windowMs: HOUR };
export const MAIL_LIMIT = { limit: 5, windowMs: HOUR };

export type RateLimit = typeof LOGIN_LIMIT;

export interface RateLimiter {
  /** Records one event and reports how many fall inside the window. */
  hit(key: string, windowMs: number): number;
  count(key: string, windowMs: number): number;
  clear(key: string): void;
}

export function createRateLimiter(now: () => number): RateLimiter {
  const events = new Map<string, number[]>();

  const recent = (key: string, windowMs: number) => {
    const cutoff = now() - windowMs;
    const kept = (events.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length > 0) events.set(key, kept);
    else events.delete(key);
    return kept;
  };

  return {
    hit(key, windowMs) {
      if (events.size > SWEEP_THRESHOLD) {
        for (const stale of events.keys()) recent(stale, HOUR);
      }
      const kept = recent(key, windowMs);
      kept.push(now());
      events.set(key, kept);
      return kept.length;
    },
    count: (key, windowMs) => recent(key, windowMs).length,
    clear: (key) => void events.delete(key),
  };
}

function tooMany(): TeamError {
  return new TeamError("rate-limited", "Too many attempts. Try again later.");
}

/** Counts one attempt against every key and rejects once any of them is over the limit. */
export function consume(
  limiter: RateLimiter,
  scope: string,
  keys: ReadonlyArray<string>,
  { limit, windowMs }: RateLimit,
): void {
  let exceeded = false;
  for (const key of keys) {
    if (limiter.hit(`${scope}:${key}`, windowMs) > limit) exceeded = true;
  }
  if (exceeded) throw tooMany();
}

export function assertNotLocked(
  limiter: RateLimiter,
  scope: string,
  keys: ReadonlyArray<string>,
  { limit, windowMs }: RateLimit,
): void {
  if (keys.some((key) => limiter.count(`${scope}:${key}`, windowMs) >= limit)) throw tooMany();
}
