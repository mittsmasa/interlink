import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

function createDb() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return drizzle({ client, schema });
}

type DbInstance = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as {
  db: DbInstance | undefined;
};

export const db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

/** db.transaction のコールバックが受け取るハンドル */
export type DbTransaction = Parameters<
  Parameters<DbInstance["transaction"]>[0]
>[0];

/**
 * db 本体とトランザクションハンドルの共通型。
 * 同じクエリをトランザクションの内外どちらでも実行したい関数
 * （リビジョン保存など）が実行主体を受け取るために使う
 */
export type DbClient = DbInstance | DbTransaction;
