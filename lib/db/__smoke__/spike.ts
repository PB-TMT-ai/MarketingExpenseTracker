/**
 * Throwaway proof harness for the Plan 01 walking-skeleton spike.
 *
 * Run with: `npm run db:spike`
 *
 * Calls the `dbSpike` Server Action directly (outside a request — it uses no request-scoped
 * APIs) to prove a live PGlite `SELECT 1` round-trip on this machine. Exits 0 on success,
 * non-zero otherwise. The dev-server path (Turbopack) is confirmed separately at the Task 4
 * human-verify checkpoint.
 */
import { dbSpike } from "../../actions/spike";

async function main() {
  const result = await dbSpike();
  // eslint-disable-next-line no-console
  console.log("dbSpike() =>", JSON.stringify(result));
  if (!result.ok || result.value !== 1) {
    // eslint-disable-next-line no-console
    console.error("SPIKE FAILED: expected { ok: true, value: 1 }");
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("SPIKE OK: live PGlite SELECT 1 round-trip proven.");
  process.exit(0);
}

void main();
