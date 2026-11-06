import { loadConfig } from "./config.ts";
import { openPglite, openPostgres } from "./db.ts";
import { createConsoleSender, createResendSender } from "./email.ts";
import { migrate } from "./migrations.ts";
import { createRateLimiter } from "./rateLimit.ts";
import { createTeamServer } from "./server.ts";

const config = loadConfig(process.env, process.cwd());

const db = config.databaseUrl ? openPostgres(config.databaseUrl) : await openPglite(config.dataDir);
await migrate(db);

if (config.resendApiKey && !config.emailFrom) {
  throw new Error("TEAM_EMAIL_FROM is required when RESEND_API_KEY is set.");
}
const mail =
  config.resendApiKey && config.emailFrom
    ? createResendSender(config.resendApiKey, config.emailFrom)
    : createConsoleSender();

const now = () => Date.now();
const server = createTeamServer({
  db,
  mail,
  limiter: createRateLimiter(now),
  now,
  publicUrl: config.publicUrl,
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(
    `[team] listening on http://${config.host}:${port} (${config.databaseUrl ? "postgres" : `pglite ${config.dataDir}`}, mail: ${mail.console ? "console" : "resend"})`,
  );
});

const shutdown = () => {
  server.close(() => void db.close().finally(() => process.exit(0)));
  server.closeAllConnections();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
