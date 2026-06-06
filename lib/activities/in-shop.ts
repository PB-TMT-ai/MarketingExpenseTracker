import type { ActivityConfig, FieldDef } from "./types";

/**
 * In-shop Branding — type `measurement`. Plan sheet adds Pin code / GST No. / Mobile No.
 * (kept as text; PITFALLS says ID-like fields never coerce to number).
 */

const planColumns: readonly FieldDef[] = [
  { key: "region", label: "Region", kind: "text", shared: true },
  { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
  { key: "dealerName", label: "Dealer Name", kind: "text" },
  { key: "state", label: "State", kind: "text", shared: true },
  { key: "district", label: "District", kind: "text", shared: true },
  { key: "distributor", label: "Distributor", kind: "text", shared: true },
  { key: "pinCode", label: "Pin code", kind: "text" },
  { key: "gstNo", label: "GST No.", kind: "text" },
  { key: "mobileNo", label: "Mobile No.", kind: "text" },
];

const actualColumns: readonly FieldDef[] = [
  { key: "status", label: "Status", kind: "status", enumValues: ["Pending", "In Progress", "Done"] },
  { key: "length", label: "Length", kind: "number" },
  { key: "breadth", label: "Breadth", kind: "number" },
  {
    key: "totalSqft",
    label: "Total Sq Ft",
    kind: "number",
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

const inShop = {
  key: "in-shop",
  label: "In-shop Branding",
  type: "measurement",
  planColumns,
  actualColumns,
} as const satisfies ActivityConfig;

export default inShop;
