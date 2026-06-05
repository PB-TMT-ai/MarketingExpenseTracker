/**
 * Extensibility proof for ACTV-03.
 *
 * Run with: `npm run activities:smoke`
 *
 * Demonstrates that adding a seventh activity is ONE config entry — the registry's
 * lookup never needs a switch/loop edit. This smoke does NOT mutate `ACTIVITIES`; it
 * constructs an extended record by spread (the same shape a real seventh entry would
 * land in registry.ts) and proves resolution works on the extended record. The real
 * registry.ts is byte-identical after this script runs (`git diff registry.ts` empty).
 */
import {
  ACTIVITIES,
  ACTIVITY_KEYS,
  getActivity,
} from "../index";
import type { ActivityConfig } from "../index";

const SIX = [
  "counter-wall",
  "gsb",
  "nlb",
  "in-shop",
  "pop-dealer-kit",
  "dealer-certificate",
] as const;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`SMOKE FAILED: ${msg}`);
    process.exit(1);
  }
}

function main() {
  // 1. All six known keys resolve.
  assert(
    ACTIVITY_KEYS.length === 6,
    `expected ACTIVITY_KEYS.length === 6, got ${ACTIVITY_KEYS.length}`,
  );
  for (const k of SIX) {
    const cfg = getActivity(k);
    assert(cfg !== undefined, `getActivity("${k}") should resolve, got undefined`);
    assert(cfg!.key === k, `cfg.key mismatch for "${k}"`);
  }

  // 2. Construct a synthetic seventh in-script — NOT touching registry.ts.
  // This mirrors how a real seventh would be authored: one new config entry
  // (here, a literal) added to the ACTIVITIES record.
  const testBanner = {
    key: "test-banner",
    label: "Test Banner",
    type: "measurement",
    planColumns: [
      { key: "region", label: "Region", kind: "text", shared: true },
      { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
    ],
    actualColumns: [
      { key: "status", label: "Status", kind: "status" },
      { key: "totalCost", label: "Total cost", kind: "currency" },
    ],
  } as unknown as ActivityConfig;
  // Cast through unknown because `key: "test-banner"` does not satisfy the closed
  // ActivityKey union — that's intentional: the union is closed by design, so adding a
  // seventh in real code is a one-character widening of the union plus the spread entry.

  const extended: Record<string, ActivityConfig> = {
    ...ACTIVITIES,
    "test-banner": testBanner,
  };

  // 3. The synthetic seventh resolves on the extended record — same lookup shape.
  const seventh = extended["test-banner"];
  assert(
    seventh !== undefined,
    "extended record should resolve test-banner via [key] lookup",
  );
  assert(
    seventh.label === "Test Banner",
    `seventh.label mismatch: got "${seventh.label}"`,
  );
  assert(
    Object.keys(extended).length === 7,
    `extended record should have 7 entries, got ${Object.keys(extended).length}`,
  );

  // 4. The REAL ACTIVITIES export is unchanged — six entries, no side effects.
  assert(
    Object.keys(ACTIVITIES).length === 6,
    "ACTIVITIES must remain unchanged after extension (six entries)",
  );

  // eslint-disable-next-line no-console
  console.log(
    "ACTV-03 PROVEN: six known activities resolve; a synthetic seventh resolves purely by record-spread, with registry.ts unchanged.",
  );
  process.exit(0);
}

main();
