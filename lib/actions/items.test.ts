import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Item-master spec. Two layers — see periods.test.ts for the same shape.
 * The load-bearing D-09 assertion: after a retire, the row STILL EXISTS (no DELETE).
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
  _resetItemsForTest,
  insertItem,
  listItems,
  setItemActive,
} from "../db/items";
import { addItem, toggleItemActive } from "./items";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetItemsForTest();
});

async function itemRowCount(): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from item_master`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

describe("lib/db/items", () => {
  it("insertItem returns a numeric id, defaults active=true", async () => {
    const id = await insertItem({ name: "Wall Stickers", category: "POP" });
    expect(id).toBeGreaterThan(0);
    const rows = await listItems();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Wall Stickers");
    expect(rows[0].active).toBe(true);
  });

  it("setItemActive(id, false) flips active without deleting the row (D-09)", async () => {
    const id = await insertItem({ name: "Posters" });
    const before = await itemRowCount();
    expect(before).toBe(1);

    await setItemActive(id, false);

    const after = await itemRowCount();
    expect(after, "row count must be unchanged after retire").toBe(before);
    const [row] = await listItems();
    expect(row.active).toBe(false);

    // restore round-trip
    await setItemActive(id, true);
    const [restored] = await listItems();
    expect(restored.active).toBe(true);
  });
});

describe("lib/actions/items (Zod + auth re-check)", () => {
  function fd(values: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  }

  it("addItem with empty name returns a validation error, inserts nothing", async () => {
    const state = await addItem({}, fd({ name: "  " }));
    expect(state.error).toBeTruthy();
    expect(await itemRowCount()).toBe(0);
  });

  it("addItem trims name; blank category stays null", async () => {
    const state = await addItem({}, fd({ name: "  Pamphlets  ", category: "  " }));
    expect(state.ok).toBe(true);
    const [row] = await listItems();
    expect(row.name).toBe("Pamphlets");
    expect(row.category).toBeNull();
  });

  it("addItem persists category when provided", async () => {
    await addItem({}, fd({ name: "Tarpaulin", category: "Outdoor" }));
    const [row] = await listItems();
    expect(row.category).toBe("Outdoor");
  });

  it("toggleItemActive retires soft (row survives, active=false)", async () => {
    const id = await insertItem({ name: "Hoardings" });
    const before = await itemRowCount();
    const state = await toggleItemActive({}, fd({ id: String(id), active: "false" }));
    expect(state.ok).toBe(true);
    expect(await itemRowCount()).toBe(before);
    const [row] = await listItems();
    expect(row.active).toBe(false);
  });

  it("toggleItemActive can restore a retired item", async () => {
    const id = await insertItem({ name: "Banners" });
    await toggleItemActive({}, fd({ id: String(id), active: "false" }));
    await toggleItemActive({}, fd({ id: String(id), active: "true" }));
    const [row] = await listItems();
    expect(row.active).toBe(true);
  });
});
