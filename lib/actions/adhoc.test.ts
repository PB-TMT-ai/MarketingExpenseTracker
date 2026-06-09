import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adhoc Server Action spec — RED phase (Task 3.5).
 *
 * Mirrors the mock pattern from lib/actions/executions.test.ts EXACTLY:
 *   - next/headers cookies() returns { value: "fake-token-for-tests" } for the "session" cookie.
 *   - next/cache revalidatePath is a vi.fn().
 *   - ../auth/session exports SESSION_COOKIE="session" and verifySession wired through
 *     a vi.fn() so tests can override it per-case.
 *
 * The mocks MUST appear BEFORE the action import — Server Actions touch cookies() during
 * requireSession() and that needs a mocked Next request context.
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

const verifySessionMock = vi.fn(async (t: string) => t === "fake-token-for-tests");
vi.mock("../auth/session", () => ({
  SESSION_COOKIE: "session",
  verifySession: (t: string) => verifySessionMock(t),
}));

import { ensureMigrated } from "../db/migrate";
import { _resetPeriodsForTest, insertPeriod } from "../db/periods";
import { _resetAdhocForTest, listAdhocByPeriod } from "../db/adhoc";
import { saveAdhocExpenses } from "./adhoc";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetAdhocForTest();
  await _resetPeriodsForTest();
  verifySessionMock.mockImplementation(async (t: string) => t === "fake-token-for-tests");
});

describe("saveAdhocExpenses", () => {
  it("rejects when periodId is missing", async () => {
    await expect(
      saveAdhocExpenses({ periodId: 0 as unknown as number, rows: [] }),
    ).rejects.toThrow(/periodId/i);
  });

  it("inserts new rows and returns the batch result", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    const result = await saveAdhocExpenses({
      periodId,
      rows: [
        {
          id: null,
          region: "N",
          state: "UP",
          district: "Agra",
          taluka: null,
          activity: "Local event",
          activityDate: "2026-05-10",
          budgetHeader: "BTL",
          expenseAmount: 12500,
          vendorName: "ACME",
          remarks: null,
          version: 0,
        },
      ],
    });
    expect(result.inserted).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(await listAdhocByPeriod(periodId)).toHaveLength(1);
  });

  it("rejects negative expense amounts", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    await expect(
      saveAdhocExpenses({
        periodId,
        rows: [
          {
            id: null,
            region: null,
            state: null,
            district: null,
            taluka: null,
            activity: "X",
            activityDate: "2026-05-10",
            budgetHeader: null,
            expenseAmount: -5,
            vendorName: null,
            remarks: null,
            version: 0,
          },
        ],
      }),
    ).rejects.toThrow(/expense/i);
  });
});
