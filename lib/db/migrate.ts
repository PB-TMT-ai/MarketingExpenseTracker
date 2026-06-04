import { migrate } from "drizzle-orm/pglite/migrator";
import { db } from "./index";

const MIGRATIONS_FOLDER = "./drizzle";

/**
 * Apply pending migrations to the LOCAL PGlite database.
 *
 * No-op when DATABASE_URL points at Supabase (postgres://): production migrations are applied
 * by `drizzle-kit migrate` against the direct (:5432, non-pooled) URL at deploy time, not here.
 * Called from instrumentation.ts at server boot and from the db:migrate:local CLI.
 */
export async function ensureMigrated(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "./.pglite";
  if (/^postgres(ql)?:\/\//.test(url)) {
    return; // Supabase: handled by `drizzle-kit migrate` at deploy time.
  }
  // `db` is the PGlite drizzle instance on this branch; the cast satisfies the union type.
  await migrate(db as Parameters<typeof migrate>[0], {
    migrationsFolder: MIGRATIONS_FOLDER,
  });
}
