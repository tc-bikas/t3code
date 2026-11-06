import * as Schema from "effect/Schema";
import type { TeamContext } from "./context.ts";
import { TeamError } from "./errors.ts";
import { authenticate, type Authenticated } from "./sessions.ts";

export interface TeamRequest {
  readonly ctx: TeamContext;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly authorization: string | undefined;
  readonly body: string;
  readonly ip: string;
}

export interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly html?: string;
  /** Turns the reply into a server-sent event stream; `status` must be 200. */
  readonly stream?: (out: EventStreamOut) => void;
}

export interface EventStreamOut {
  write(chunk: string): void;
  end(): void;
  /** Runs once when the stream ends, from either side. */
  onClose(listener: () => void): void;
}

export interface Route {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly handle: (req: TeamRequest) => Promise<Reply>;
}

export const ok = (json: unknown): Reply => ({ status: 200, json });
export const noContent: Reply = { status: 204 };

export const requireAuth = (req: TeamRequest): Promise<Authenticated> =>
  authenticate(req.ctx, req.authorization);

export function decodeBody<T>(schema: Schema.Decoder<T>, body: string): T {
  let value: unknown;
  try {
    value = body.trim() === "" ? {} : JSON.parse(body);
  } catch {
    throw new TeamError("invalid-input", "The request body is not valid JSON.");
  }
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch (cause) {
    throw new TeamError(
      "invalid-input",
      cause instanceof Error ? cause.message : "The request body is not valid.",
    );
  }
}

export const param = (req: TeamRequest, name: string): string => req.params[name] ?? "";
