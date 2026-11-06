import * as NodePath from "node:path";

export interface TeamConfig {
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string | undefined;
  readonly dataDir: string;
  readonly publicUrl: string;
  readonly resendApiKey: string | undefined;
  readonly emailFrom: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd: string): TeamConfig {
  const port = Number(env.TEAM_PORT ?? 3790);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`TEAM_PORT must be a port number, got "${env.TEAM_PORT}"`);
  }
  return {
    port,
    host: env.TEAM_HOST || "127.0.0.1",
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.TEAM_DATA_DIR || NodePath.join(cwd, ".t3-team", "pgdata"),
    publicUrl: (env.TEAM_PUBLIC_URL || "http://localhost:3790").replace(/\/+$/, ""),
    resendApiKey: env.RESEND_API_KEY || undefined,
    emailFrom: env.TEAM_EMAIL_FROM || undefined,
  };
}
