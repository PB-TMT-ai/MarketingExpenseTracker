import type { ActivityConfig, FieldDef } from "./types";
import { STATUS_VALUES } from "./status";

/**
 * Dealer Certificate — type `status`. Plan sheet uses the shared who/where set;
 * actuals are the issuance state — Status + Date + Cost.
 */

const planColumns: readonly FieldDef[] = [
  { key: "region", label: "Region", kind: "text", shared: true },
  { key: "state", label: "State", kind: "text", shared: true },
  { key: "district", label: "District", kind: "text", shared: true },
  { key: "distributor", label: "Distributor", kind: "text", shared: true },
  { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
  { key: "dealer", label: "Dealer", kind: "text", shared: true },
];

const actualColumns: readonly FieldDef[] = [
  { key: "status", label: "Status", kind: "status", enumValues: STATUS_VALUES },
  { key: "issuanceDate", label: "Date", kind: "date" },
  { key: "cost", label: "Cost", kind: "currency" },
];

const dealerCertificate = {
  key: "dealer-certificate",
  label: "Dealer Certificate",
  type: "status",
  planColumns,
  actualColumns,
} as const satisfies ActivityConfig;

export default dealerCertificate;
