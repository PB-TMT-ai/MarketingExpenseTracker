import type { ActivityConfig, FieldDef } from "./types";
import { STATUS_VALUES } from "./status";

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
  { key: "status", label: "Status", kind: "status", enumValues: STATUS_VALUES },
  { key: "nlbType", label: "NLB type", kind: "text" },
  { key: "length", label: "Length", kind: "number" },
  { key: "breadth", label: "Breadth", kind: "number" },
  // P1-4: Height is captured for reference only — it is NOT a factor in the
  // area formula (Total Sq Ft = Length × Breadth, D3-04). The "(ref)" label
  // makes that explicit so a reviewer doesn't enter height expecting the area
  // to change, then "fix" it with a spurious override.
  { key: "height", label: "Height (ref)", kind: "number" },
  {
    key: "totalSqft",
    label: "Total Sq Ft",
    kind: "number",
    // P1-4: height removed from computeFrom — it never fed the formula; listing
    // it here implied a dependency that does not exist.
    computeFrom: ["length", "breadth"],
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
