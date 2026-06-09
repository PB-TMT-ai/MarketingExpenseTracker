import type { ActivityConfig, FieldDef } from "./types";
import { STATUS_VALUES } from "./status";

/**
 * Counter Wall Painting — type `measurement`.
 * Plan + actual columns transcribed verbatim from PROJECT.md "Activity column specs".
 * Computed columns (mark `computeFrom`) carry a declarative source-key list; the formula
 * lives in the consumer (Phase-3 grid), not here.
 */

const planColumns: readonly FieldDef[] = [
  { key: "region", label: "Region", kind: "text", shared: true },
  { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
  { key: "dealerOrArea", label: "Dealer/Area", kind: "text" },
  { key: "state", label: "State", kind: "text", shared: true },
  { key: "district", label: "District", kind: "text", shared: true },
  { key: "taluka", label: "Taluka", kind: "text", shared: true },
  { key: "planSqft", label: "Plan Sq Ft", kind: "number" },
  { key: "distributor", label: "Distributor", kind: "text", shared: true },
];

const actualColumns: readonly FieldDef[] = [
  { key: "status", label: "Status", kind: "status", enumValues: STATUS_VALUES },
  { key: "latitude", label: "Latitude", kind: "lat" },
  { key: "longitude", label: "Longitude", kind: "long" },
  // Label note: VendorInitials_wallNo_DD/MM/YY
  { key: "wallShopNo", label: "Wall/Shop No", kind: "text" },
  { key: "executionDate", label: "Execution Date", kind: "date" },
  { key: "executionMonth", label: "Execution Month", kind: "text" },
  { key: "remarks", label: "Remarks", kind: "text" },
  { key: "actualSqft", label: "Actual Sq Ft", kind: "number" },
  { key: "perUnitCost", label: "Per-unit cost", kind: "currency" },
  {
    key: "totalCost",
    label: "Total cost",
    kind: "currency",
    computeFrom: ["actualSqft", "perUnitCost"],
  },
];

const counterWall = {
  key: "counter-wall",
  label: "Counter Wall Painting",
  type: "measurement",
  planColumns,
  actualColumns,
} as const satisfies ActivityConfig;

export default counterWall;
