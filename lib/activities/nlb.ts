import type { ActivityConfig, FieldDef } from "./types";

/**
 * NLB — type `measurement`. Shares its column shape with GSB but registered as a
 * SEPARATE entry with distinct key/label.
 */

const planColumns: readonly FieldDef[] = [
  { key: "region", label: "Region", kind: "text", shared: true },
  { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
  { key: "dealerName", label: "Dealer Name", kind: "text" },
  { key: "state", label: "State", kind: "text", shared: true },
  { key: "district", label: "District", kind: "text", shared: true },
  { key: "taluka", label: "Taluka", kind: "text", shared: true },
  { key: "distributor", label: "Distributor", kind: "text", shared: true },
];

const actualColumns: readonly FieldDef[] = [
  { key: "status", label: "Status", kind: "status", enumValues: ["Pending", "In Progress", "Done"] },
  { key: "nlbType", label: "NLB type", kind: "text" },
  { key: "length", label: "Length", kind: "number" },
  { key: "breadth", label: "Breadth", kind: "number" },
  { key: "height", label: "Height", kind: "number" },
  {
    key: "totalSqft",
    label: "Total Sq Ft",
    kind: "number",
    computeFrom: ["length", "breadth", "height"],
  },
  { key: "perUnitCost", label: "Per-unit cost", kind: "currency" },
  {
    key: "totalCost",
    label: "Total cost",
    kind: "currency",
    computeFrom: ["totalSqft", "perUnitCost"],
  },
  { key: "remarks", label: "Remarks", kind: "text" },
];

const nlb = {
  key: "nlb",
  label: "NLB",
  type: "measurement",
  planColumns,
  actualColumns,
} as const satisfies ActivityConfig;

export default nlb;
