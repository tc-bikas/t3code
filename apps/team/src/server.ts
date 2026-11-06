import * as NodeHttp from "node:http";
import { authRoutes } from "./authRoutes.ts";
import type { TeamContext } from "./context.ts";
import { TEAM_ERROR_STATUS, TeamError } from "./errors.ts";
import type { Reply, Route } from "./http.ts";
import { dmRoutes } from "./dmRoutes.ts";
import { meRoutes } from "./meRoutes.ts";
import { orgRoutes } from "./orgRoutes.ts";
import { pageRoutes } from "./pages.ts";

const MAX_BODY_BYTES = 64 * 1024;

const ROUTES: ReadonlyArray<Route> = [
  {
    method: "GET",
    path: "/v1/health",
    handle: async () => ({ status: 200, json: { ok: true } }),
  },
  ...authRoutes,
  ...meRoutes,
  ...dmRoutes,
  ...orgRoutes,
  ...pageRoutes,
];

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const want = pattern.split("/");
  const have = path.split("/");
  if (want.length !== have.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    const actual = have[index] ?? "";
    if (segment.startsWith(":")) {
      if (!actual) return undefined;
      params[segment.slice(1)] = decodeURIComponent(actual);
    } else if (segment !== actual) {
      return undefined;
    }
  }
  return params;
}

const errorReply = (code: TeamError["code"], message: string): Reply => ({
  status: TEAM_ERROR_STATUS[code],
  json: { error: { code, message } },
});

export interface IncomingRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
  readonly ip: string;
}

export async function handleRequest(ctx: TeamContext, incoming: IncomingRequest): Promise<Reply> {
  try {
    const url = new URL(incoming.url, "http://team.invalid");
    for (const route of ROUTES) {
      if (route.method !== incoming.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (!params) continue;
      return await route.handle({
        ctx,
        params,
        query: url.searchParams,
        authorization: incoming.authorization,
        body: incoming.body,
        ip: incoming.ip,
      });
    }
    return errorReply("not-found", "Not found.");
  } catch (cause) {
    if (cause instanceof TeamError) return errorReply(cause.code, cause.message);
    console.error("[team] unexpected error:", cause instanceof Error ? cause.message : "unknown");
    return errorReply("unavailable", "Something went wrong. Try again shortly.");
  }
}

function readBody(req: NodeHttp.IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep draining so the 413 reaches a client that is still uploading.
        chunks.length = 0;
        resolve(undefined);
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Behind a proxy the last X-Forwarded-For entry is the one the nearest proxy appended. */
function clientIp(req: NodeHttp.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const last = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded)
    ?.split(",")
    .at(-1)
    ?.trim();
  return last || req.socket.remoteAddress || "unknown";
}

function send(res: NodeHttp.ServerResponse, reply: Reply): void {
  const headers: NodeHttp.OutgoingHttpHeaders = { ...CORS_HEADERS };
  let payload: string | undefined;
  if (reply.html !== undefined) {
    Object.assign(headers, HTML_HEADERS);
    payload = reply.html;
  } else if (reply.json !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    payload = JSON.stringify(reply.json);
  }
  if (reply.status === 413) headers.connection = "close";
  if (reply.stream) {
    Object.assign(headers, {
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    res.writeHead(reply.status, headers);
    const listeners: Array<() => void> = [];
    let closed = false;
    res.on("close", () => {
      closed = true;
      for (const listener of listeners) listener();
    });
    reply.stream({
      write: (chunk) => void (!closed && res.write(chunk)),
      end: () => res.end(),
      onClose: (listener) => void listeners.push(listener),
    });
    return;
  }
  res.writeHead(reply.status, headers);
  res.end(payload);
}

export function createTeamServer(ctx: TeamContext): NodeHttp.Server {
  return NodeHttp.createServer((req, res) => {
    void (async () => {
      if (req.method === "OPTIONS") return send(res, { status: 204 });
      const body = await readBody(req);
      if (body === undefined) {
        return send(res, {
          status: 413,
          json: { error: { code: "invalid-input", message: "The request body is too large." } },
        });
      }
      send(
        res,
        await handleRequest(ctx, {
          method: req.method ?? "GET",
          url: req.url ?? "/",
          authorization: req.headers.authorization,
          body,
          ip: clientIp(req),
        }),
      );
    })().catch(() => {
      if (!res.headersSent) send(res, errorReply("unavailable", "Something went wrong."));
      else res.destroy();
    });
  });
}
