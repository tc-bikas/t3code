import * as NodeFS from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export interface Queryable {
  /** Without `params` the SQL may hold several statements (migrations). */
  query<R extends object>(sql: string, params?: ReadonlyArray<unknown>): Promise<R[]>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Embedded Postgres for local development; an in-memory instance when `dataDir` is omitted. */
export async function openPglite(dataDir?: string): Promise<Db> {
  // PGlite creates only the last path segment, so `.t3-team` itself must exist first.
  if (dataDir !== undefined) NodeFS.mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  const wrap = (q: Pick<PGlite, "query" | "exec">): Queryable => ({
    async query<R extends object>(sql: string, params?: ReadonlyArray<unknown>) {
      if (params === undefined) {
        const results = await q.exec(sql);
        return (results.at(-1)?.rows ?? []) as R[];
      }
      const result = await q.query<R>(sql, [...params]);
      return result.rows;
    },
  });
  return {
    ...wrap(lite),
    transaction: (fn) => lite.transaction((tx) => fn(wrap(tx))),
    close: () => lite.close(),
  };
}

export function openPostgres(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const wrap = (q: pg.Pool | pg.PoolClient): Queryable => ({
    async query<R extends object>(sql: string, params?: ReadonlyArray<unknown>) {
      const result = await q.query<R & pg.QueryResultRow>(sql, params && [...params]);
      return result.rows;
    },
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(wrap(client));
        await client.query("COMMIT");
        return value;
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function isUniqueViolation(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}
