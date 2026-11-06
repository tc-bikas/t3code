import { TeamError } from "./errors.ts";

const SWEEP_THRESHOLD = 10_000;

export interface RateLimiter {
  /** Records one event and reports how many fall inside the window. */
  hit(key: string, windowMs: number): number;
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
        for (const stale of events.keys()) recent(stale, windowMs);
      }
      const kept = recent(key, windowMs);
      kept.push(now());
      events.set(key, kept);
      return kept.length;
    },
  };
}

export function consume(
  limiter: RateLimiter,
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  message = "Too many sign-in attempts. Try again in a few minutes.",
): void {
  if (limiter.hit(key, windowMs) > limit) {
    throw new TeamError("rate-limited", message);
  }
}
