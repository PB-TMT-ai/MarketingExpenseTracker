"use server";

import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * The walking-skeleton spike: proves a real round-trip to the embedded database.
 * A Server Action runs `SELECT 1` against PGlite and returns the value — if this
 * returns `{ ok: true, value: 1 }`, the whole local stack (Next server runtime →
 * Drizzle → PGlite WASM) is wired correctly. Replaced by real data actions in later phases.
 */
export async function dbSpike(): Promise<{
  ok: boolean;
  value: number | null;
  error?: string;
}> {
  try {
    const raw: unknown = await db.execute(sql`select 1 as v`);
    // Driver result shape differs: PGlite returns `{ rows: [...] }`, postgres-js returns
    // an array-like RowList. Normalize via `unknown` so neither driver's type leaks here.
    const rows = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<Record<string, unknown>>;
    const value = rows.length ? Number(rows[0]?.v) : null;
    return { ok: value === 1, value };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
