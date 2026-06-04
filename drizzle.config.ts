import { defineConfig } from "drizzle-kit";

/**
 * One migration source of truth. `drizzle-kit generate` reads the schema and emits SQL into
 * ./drizzle; that same SQL is applied to PGlite via the programmatic migrator (lib/db/migrate.ts)
 * locally and to Supabase via `drizzle-kit migrate` against the direct (:5432) URL at deploy.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./.pglite",
  },
});
