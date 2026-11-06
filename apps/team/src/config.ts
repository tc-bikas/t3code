import * as NodePath from "node:path";

export interface TeamConfig {
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string | undefined;
  readonly dataDir: string;
  readonly publicUrl: string;
  /** Empty means open sign-in. */
  readonly allowedEmailDomains: ReadonlyArray<string>;
  /** Present only when both the client id and the secret are set. */
  readonly github: { readonly clientId: string; readonly clientSecret: string } | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd: string): TeamConfig {
  const port = Number(env.TEAM_PORT ?? 3790);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`TEAM_PORT must be a port number, got "${env.TEAM_PORT}"`);
  }
  const clientId = env.TEAM_GITHUB_CLIENT_ID;
  const clientSecret = env.TEAM_GITHUB_CLIENT_SECRET;
  return {
    port,
    host: env.TEAM_HOST || "127.0.0.1",
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.TEAM_DATA_DIR || NodePath.join(cwd, ".t3-team", "pgdata"),
    publicUrl: (env.TEAM_PUBLIC_URL || "http://localhost:3790").replace(/\/+$/, ""),
    allowedEmailDomains: (env.TEAM_ALLOWED_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    github: clientId && clientSecret ? { clientId, clientSecret } : undefined,
  };
}
