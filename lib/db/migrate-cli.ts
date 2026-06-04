/**
 * CLI entry for `npm run db:migrate:local` — applies pending migrations to the local PGlite DB.
 * (Supabase is migrated separately via `drizzle-kit migrate` at deploy time.)
 */
import { ensureMigrated } from "./migrate";

async function main() {
  await ensureMigrated();
  // eslint-disable-next-line no-console
  console.log("Migrations applied to the local PGlite DB.");
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err);
  process.exit(1);
});
