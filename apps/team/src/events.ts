import type { TeamEvent } from "@t3tools/contracts";
import type { TeamContext } from "./context.ts";
import type { EventStreamOut } from "./http.ts";
import { authenticate } from "./sessions.ts";

/** In-process only: Postgres LISTEN/NOTIFY can implement this later to lift the one-instance limit. */
export interface EventBus {
  publish(userId: string, event: TeamEvent): void;
  subscribe(userId: string, listener: (event: TeamEvent) => void): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<(event: TeamEvent) => void>>();
  return {
    publish(userId, event) {
      for (const listener of listeners.get(userId) ?? []) listener(event);
    },
    subscribe(userId, listener) {
      const set = listeners.get(userId) ?? new Set();
      set.add(listener);
      listeners.set(userId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(userId) === set) listeners.delete(userId);
      };
    },
  };
}

const PING_INTERVAL_MS = 25_000;

/** Streams the caller's events; a ping both keeps proxies open and notices a revoked session. */
export function openEventStream(
  ctx: TeamContext,
  userId: string,
  authorization: string | undefined,
  out: EventStreamOut,
): void {
  const unsubscribe = ctx.events.subscribe(userId, (event) =>
    out.write(`data: ${JSON.stringify(event)}\n\n`),
  );
  const stopPing = ctx.every(PING_INTERVAL_MS, () => {
    authenticate(ctx, authorization).then(
      () => out.write(": ping\n\n"),
      () => out.end(),
    );
  });
  out.onClose(() => {
    unsubscribe();
    stopPing();
  });
  out.write(": connected\n\n");
}
