import type { ActivityConfig, FieldDef } from "./types";

/**
 * POP / Dealer Kit — type `item-list`.
 * Parent (plan) row carries the who/where shared set. Actuals are LINE ITEMS — each row in
 * `actualColumns` describes ONE line item (item name, qty, per-unit cost, line total).
 * Item names come from the managed item master (ACTV-04 / D-08 — name SNAPSHOT at entry,
 * not an FK). The multi-item popup that lets the user add several lines lives in Phase 3.
 */

const planColumns: readonly FieldDef[] = [
  { key: "region", label: "Region", kind: "text", shared: true },
  { key: "state", label: "State", kind: "text", shared: true },
  { key: "district", label: "District", kind: "text", shared: true },
  { key: "distributor", label: "Distributor", kind: "text", shared: true },
  { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
  { key: "dealer", label: "Dealer", kind: "text", shared: true },
];

// Per-line FieldDefs describing ONE item in a POP / dealer-kit entry.
// Multiple of these per parent row are added through the entry popup in Phase 3.
const actualColumns: readonly FieldDef[] = [
  { key: "itemName", label: "Item", kind: "text" },
  { key: "qty", label: "Qty", kind: "number" },
  { key: "rate", label: "Per-unit cost", kind: "currency" },
  {
    key: "lineTotal",
    label: "Total",
    kind: "currency",
    computeFrom: ["qty", "rate"],
  },
];

const popDealerKit = {
  key: "pop-dealer-kit",
  label: "POP / Dealer Kit",
  type: "item-list",
  planColumns,
  actualColumns,
} as const satisfies ActivityConfig;

export default popDealerKit;
