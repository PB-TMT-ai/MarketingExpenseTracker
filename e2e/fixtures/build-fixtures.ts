/**
 * One-off fixture builder for e2e/plans.spec.ts.
 *
 * Generates two deterministic .xlsx fixtures used by the Playwright suite:
 *   - plan-counter-wall.xlsx        — 2 valid counter-wall rows (SF-A, SF-B)
 *   - plan-counter-wall-only-b.xlsx — 1 row (SF-B only) for the blocked-by-actuals test
 *
 * Headers exactly mirror getActivity("counter-wall").planColumns labels in order
 * (D2-03 — case-sensitive match here; validateHeaders is case-insensitive at runtime).
 *
 * The fixtures are tiny binary .xlsx files; we check them into the repo so
 * `npm run e2e` is hermetic (no fixture-rebuild step in CI). Re-run this script
 * via `npm run fixtures:build` only when the counter-wall column shape changes.
 *
 * Run with: npm run fixtures:build
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { getActivity } from "../../lib/activities/registry";

function buildXlsx(rows: readonly (readonly unknown[])[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Plan");
  // Node-side: `type: "buffer"` returns a Node Buffer directly — writeFileSync
  // on Node 24+ refuses raw ArrayBuffer, so we ask SheetJS for a Buffer.
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function main() {
  const cfg = getActivity("counter-wall");
  if (!cfg) throw new Error("counter-wall not registered");
  const headers = cfg.planColumns.map((c) => c.label);

  // Build a per-column value map for one row, then serialize in plan-column order.
  function row(values: Readonly<Record<string, string | number>>): unknown[] {
    return cfg!.planColumns.map((c) => values[c.key] ?? "");
  }

  const sfA = row({
    region: "West",
    sfid: "SF-A",
    dealerOrArea: "ACME Counter A",
    state: "Maharashtra",
    district: "Pune",
    taluka: "Haveli",
    planSqft: 120,
    distributor: "ACME Dist",
  });
  const sfB = row({
    region: "West",
    sfid: "SF-B",
    dealerOrArea: "ACME Counter B",
    state: "Maharashtra",
    district: "Pune",
    taluka: "Haveli",
    planSqft: 90,
    distributor: "ACME Dist",
  });

  const both = buildXlsx([headers, sfA, sfB]);
  const onlyB = buildXlsx([headers, sfB]);

  const outDir = join(process.cwd(), "e2e", "fixtures");
  writeFileSync(join(outDir, "plan-counter-wall.xlsx"), both);
  writeFileSync(join(outDir, "plan-counter-wall-only-b.xlsx"), onlyB);
  // eslint-disable-next-line no-console
  console.log("wrote e2e/fixtures/plan-counter-wall{,-only-b}.xlsx");

  // --- 03-05 fixtures: POP/Dealer-Kit + Dealer Certificate (one dealer each) ---
  // Generic single-row plan fixture for any activity, headers in planColumns order.
  function planFixture(
    key: string,
    values: Readonly<Record<string, string | number>>,
  ): Buffer {
    const c = getActivity(key);
    if (!c) throw new Error(`${key} not registered`);
    const hdr = c.planColumns.map((col) => col.label);
    const r = c.planColumns.map((col) => values[col.key] ?? "");
    return buildXlsx([hdr, r]);
  }

  const who = {
    region: "West",
    state: "Maharashtra",
    district: "Pune",
    distributor: "ACME Dist",
  };
  writeFileSync(
    join(outDir, "plan-pop-dealer-kit.xlsx"),
    planFixture("pop-dealer-kit", {
      ...who,
      sfid: "SF-POP",
      dealer: "ACME POP Dealer",
    }),
  );
  writeFileSync(
    join(outDir, "plan-dealer-certificate.xlsx"),
    planFixture("dealer-certificate", {
      ...who,
      sfid: "SF-CERT",
      dealer: "ACME Cert Dealer",
    }),
  );
  // eslint-disable-next-line no-console
  console.log(
    "wrote e2e/fixtures/plan-pop-dealer-kit.xlsx + plan-dealer-certificate.xlsx",
  );
}

main();
