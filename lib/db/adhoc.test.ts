import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureMigrated } from "./migrate";
import { _resetPeriodsForTest, insertPeriod } from "./periods";
import {
  listAdhocByPeriod,
  upsertAdhocBatch,
  _resetAdhocForTest,
  type AdhocInput,
} from "./adhoc";

/**
 * PGlite-backed integration tests for `lib/db/adhoc.ts`.
 *
 * Locks the invariants Plan slice 3 ships:
 *   - Insert-on-null-id with version=0.
 *   - Update-by-id-and-version; version bumps on success.
 *   - Stale-version updates are COLLECTED into `conflicts`, not thrown
 *     (mirrors saveExecutionsBatch's partial-success semantics, D3-11).
 *
 * Cleanup order is FK-safe: adhoc_expenses → periods.
 */

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetAdhocForTest();
  await _resetPeriodsForTest();
});

describe("adhoc DAL", () => {
  it("inserts a fresh row when id is null and returns it from listAdhocByPeriod", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });

    const input: AdhocInput = {
      id: null,
      periodId,
      region: "North",
      state: "UP",
      district: "Agra",
      taluka: "Agra Sadar",
      activity: "Local event",
      activityDate: "2026-05-10",
      budgetHeader: "BTL",
      expenseAmount: "12500.00",
      vendorName: "ACME Events",
      remarks: "monsoon promo",
      version: 0,
    };
    const result = await upsertAdhocBatch([input]);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.conflicts).toEqual([]);

    const rows = await listAdhocByPeriod(periodId);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorName).toBe("ACME Events");
    expect(rows[0].region).toBe("North");
    expect(rows[0].version).toBe(0);
  });

  it("updates a row when id is given and version matches; bumps version", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    await upsertAdhocBatch([
      {
        id: null,
        periodId,
        region: "N",
        state: "UP",
        district: null,
        taluka: null,
        activity: "X",
        activityDate: "2026-05-10",
        budgetHeader: "BTL",
        expenseAmount: "100.00",
        vendorName: "A",
        remarks: null,
        version: 0,
      },
    ]);
    const orig = (await listAdhocByPeriod(periodId))[0];
    expect(orig.expenseAmount).toBe("100.00");

    const updated = await upsertAdhocBatch([
      { ...orig, expenseAmount: "200.00" } as AdhocInput,
    ]);
    expect(updated.updated).toBe(1);
    expect(updated.inserted).toBe(0);
    expect(updated.conflicts).toEqual([]);

    const fresh = (await listAdhocByPeriod(periodId))[0];
    expect(fresh.expenseAmount).toBe("200.00");
    expect(fresh.version).toBe(1);
  });

  it("collects version conflicts instead of throwing", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    await upsertAdhocBatch([
      {
        id: null,
        periodId,
        region: null,
        state: null,
        district: null,
        taluka: null,
        activity: "X",
        activityDate: "2026-05-10",
        budgetHeader: null,
        expenseAmount: "100.00",
        vendorName: null,
        remarks: null,
        version: 0,
      },
    ]);
    const orig = (await listAdhocByPeriod(periodId))[0];

    // Pretend client sent stale version 0 — but the row is at version 0, so first do an
    // update to bump it to 1, then send a stale-version 0 update.
    await upsertAdhocBatch([{ ...orig, expenseAmount: "150.00" } as AdhocInput]);

    const stale: AdhocInput = {
      ...orig,
      expenseAmount: "999.00",
      version: 0, // STALE — current is 1
    };
    const res = await upsertAdhocBatch([stale]);
    expect(res.updated).toBe(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].id).toBe(orig.id);
    expect(res.conflicts[0].serverVersion).toBe(1);

    // The row's amount stayed at 150.00, not 999.00.
    const fresh = (await listAdhocByPeriod(periodId))[0];
    expect(fresh.expenseAmount).toBe("150.00");
  });
});
