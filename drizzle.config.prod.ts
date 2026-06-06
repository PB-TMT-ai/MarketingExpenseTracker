import { defineConfig } from "drizzle-kit";

/**
 * PRODUCTION migration config — Supabase / any cloud Postgres.
 *
 * Local dev uses `drizzle.config.ts` (driver: "pglite"). That driver cannot connect to a
 * real Postgres over the wire, so this prod config OMITS it — drizzle-kit then uses its
 * built-in Postgres connector (the `postgres` package already in deps).
 *
 * Run against the Supabase DIRECT connection — port :5432, NOT the :6543 transaction pooler
 * (the pooler is for the app runtime; DDL/migrations need the direct connection):
 *
 *   # bash / macOS / Linux
 *   DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres?sslmode=require" \
 *     npm run db:migrate:prod
 *
 *   # PowerShell (Windows)
 *   $env:DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres?sslmode=require"; `
 *     npm run db:migrate:prod
 *
 * This applies every file in ./drizzle (currently 0000 + 0001) and records them in the
 * drizzle migrations table, so re-running is safe and future Phase 4/5 migrations just work.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
