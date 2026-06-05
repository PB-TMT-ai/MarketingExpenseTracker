import { asc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { itemMaster } from "./schema";

/**
 * Typed query helpers for the item_master table.
 *
 * D-09: retiring an item is a flag toggle, NEVER a hard delete. Once a POP / dealer-kit
 * line item snapshots a name (D-08), that historical row must not be orphaned by a later
 * DELETE here. This module deliberately exposes no `delete*` function.
 */

export type ItemRow = {
  id: number;
  name: string;
  category: string | null;
  active: boolean;
};

export type NewItem = {
  name: string;
  category?: string | null;
};

export async function listItems(): Promise<ItemRow[]> {
  const rows = await db.select().from(itemMaster).orderBy(asc(itemMaster.name));
  return rows as ItemRow[];
}

export async function insertItem(values: NewItem): Promise<number> {
  const [row] = await db
    .insert(itemMaster)
    .values({
      name: values.name,
      category: values.category ?? null,
      // `active` defaults true via the schema.
    })
    .returning();
  return Number((row as { id: number | string }).id);
}

/** Flip the active flag on a row. NEVER use this to "delete" — soft toggle only. */
export async function setItemActive(id: number, active: boolean): Promise<void> {
  await db
    .update(itemMaster)
    .set({ active })
    .where(eq(itemMaster.id, id));
}

/** Test/smoke helper — wipes the item_master table. NEVER call from app code. */
export async function _resetItemsForTest(): Promise<void> {
  await db.execute(sql`delete from item_master`);
}
