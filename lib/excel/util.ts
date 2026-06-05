/**
 * Pure utility helpers for the lib/excel layer.
 *
 * FRAMEWORK-FREE: no react, no next, no drizzle, no node built-ins. This module runs
 * unchanged in both the browser parse path and vitest.
 */

/**
 * Chunked generator for bulk inserts (RESEARCH §4: 500 rows ≈ ~10 000 wire params for
 * a ~20-column insert, well under Postgres's 65535-parameter cap). Plan 02-02's
 * `commitPlanUpload` transaction calls this around `tx.insert(planRows).values(chunk)`
 * to keep each statement under the wire-protocol bound on both PGlite and Supabase.
 *
 * The chunks MUST be consumed inside the same `db.transaction(...)` callback —
 * chunking outside the transaction is what breaks the atomic-commit guarantee.
 */
export function* chunked<T>(arr: readonly T[], size: number): Generator<T[]> {
  if (size <= 0) throw new Error(`chunked: size must be > 0, got ${size}`);
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size);
  }
}
