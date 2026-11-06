import { loadConfig } from "./config.ts";
import { openPglite, openPostgres } from "./db.ts";
import { realEvery } from "./context.ts";
import { createEventBus } from "./events.ts";
import { createGithubClient } from "./github.ts";
import { migrate } from "./migrations.ts";
import { createRateLimiter } from "./rateLimit.ts";
import { createTeamServer } from "./server.ts";

const config = loadConfig(process.env, process.cwd());

const db = config.databaseUrl ? openPostgres(config.databaseUrl) : await openPglite(config.dataDir);
await migrate(db);

const now = () => Date.now();
const server = createTeamServer({
  db,
  github: config.github && { ...config.github, client: createGithubClient() },
  limiter: createRateLimiter(now),
  now,
  publicUrl: config.publicUrl,
  allowedEmailDomains: config.allowedEmailDomains,
  events: createEventBus(),
  every: realEvery,
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(
    `[team] listening on http://${config.host}:${port} (${config.databaseUrl ? "postgres" : `pglite ${config.dataDir}`}, github: ${config.github ? "configured" : "not configured"})`,
  );
});

const shutdown = () => {
  server.close(() => void db.close().finally(() => process.exit(0)));
  server.closeAllConnections();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
