import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Periods spec.
 *
 * Two layers:
 *   - lib/db/periods.ts — the load-bearing invariants (single-active after two toggles).
 *   - lib/actions/periods.ts — Zod validation + auth re-check. Server Actions need a
 *     Next request context, so cookies() / revalidatePath / verifySession are mocked.
 *
 * Tests run against the live PGlite DB (the same shared `db` instance the app uses).
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "session" ? { value: "fake-token-for-tests" } : undefined,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("../auth/session", () => ({
  SESSION_COOKIE: "session",
  verifySession: async (t: string) => t === "fake-token-for-tests",
}));

import { sql } from "drizzle-orm";
import { db } from "../db";
import { ensureMigrated } from "../db/migrate";
import {
  _resetPeriodsForTest,
  getActivePeriodRow,
  insertPeriod,
  listPeriods,
  setActiveTx,
} from "../db/periods";
import { createPeriod, setActivePeriod } from "./periods";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetPeriodsForTest();
});

describe("lib/db/periods", () => {
  it("insertPeriod returns a numeric id and listPeriods sees the row", async () => {
    const id = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(id).toBeGreaterThan(0);
    const rows = await listPeriods();
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Aug 2026");
    expect(rows[0].isActive).toBe(false); // default false
  });

  it("setActiveTx leaves exactly ONE active period after two distinct toggles (D-11)", async () => {
    const id1 = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const id2 = await insertPeriod({
      type: "month",
      label: "Sep 2026",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });

    await setActiveTx(id1);
    await setActiveTx(id2); // last write wins

    const raw = await db.execute(
      sql`select count(*)::int as n from periods where is_active = true`,
    );
    const rows = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);

    const active = await getActivePeriodRow();
    expect(active?.id).toBe(id2);
  });
});

describe("lib/actions/periods (Zod + auth re-check)", () => {
  function fd(values: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  }

  it("createPeriod rejects an invalid type", async () => {
    const state = await createPeriod(
      {},
      fd({
        type: "fortnight", // not in z.enum
        label: "x",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      }),
    );
    expect(state.error).toBeTruthy();
    expect(await listPeriods()).toHaveLength(0); // nothing inserted
  });

  it("createPeriod rejects empty label", async () => {
    const state = await createPeriod(
      {},
      fd({
        type: "month",
        label: "   ",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      }),
    );
    expect(state.error).toBeTruthy();
    expect(await listPeriods()).toHaveLength(0);
  });

  it("createPeriod rejects endDate < startDate", async () => {
    const state = await createPeriod(
      {},
      fd({
        type: "month",
        label: "Bad",
        startDate: "2026-08-15",
        endDate: "2026-08-01",
      }),
    );
    expect(state.error).toBeTruthy();
    expect(await listPeriods()).toHaveLength(0);
  });

  it("createPeriod with makeActive sets the new period active (D-11 path)", async () => {
    const state = await createPeriod(
      {},
      fd({
        type: "quarter",
        label: "Q3 FY27",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        makeActive: "on",
      }),
    );
    expect(state.ok).toBe(true);
    expect(state.id).toBeGreaterThan(0);
    const active = await getActivePeriodRow();
    expect(active?.id).toBe(state.id);
  });

  it("setActivePeriod toggles via action and leaves exactly one active", async () => {
    const id1 = await insertPeriod({
      type: "month",
      label: "P1",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const id2 = await insertPeriod({
      type: "month",
      label: "P2",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    await setActivePeriod({}, fd({ id: String(id1) }));
    await setActivePeriod({}, fd({ id: String(id2) }));

    const raw = await db.execute(
      sql`select count(*)::int as n from periods where is_active = true`,
    );
    const rows = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
    const active = await getActivePeriodRow();
    expect(active?.id).toBe(id2);
  });
});
