import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The single seam between local and cloud.
 *
 * One `DATABASE_URL` decides the driver:
 *   - `postgres://` / `postgresql://`  → Supabase (postgres-js, transaction pooler; prepare:false required)
 *   - anything else (default `./.pglite`) → embedded PGlite (real Postgres, zero install)
 *
 * Drizzle keeps the schema byte-identical across both, so local → cloud is a `DATABASE_URL`
 * swap, not a code change (PROJECT.md D-14, local-first).
 *
 * The instance is cached on `globalThis` so Next's dev hot-reload reuses PGlite's single
 * embedded connection instead of opening a new one on every module re-evaluation
 * (RESEARCH Pitfall 3 — PGlite is single-connection).
 */

const url = process.env.DATABASE_URL ?? "./.pglite";
const isPostgres = /^postgres(ql)?:\/\//.test(url);

function createDb() {
  if (isPostgres) {
    // Supabase transaction pooler (:6543) does NOT support prepared statements.
    return postgresDrizzle(postgres(url, { prepare: false }), { schema });
  }
  return pgliteDrizzle(new PGlite(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __db?: Db };

export const db: Db = (globalForDb.__db ??= createDb());
