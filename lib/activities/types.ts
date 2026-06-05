/**
 * Typed contracts for the activity config registry (ACTV-01..03).
 *
 * The registry is the spine every later subsystem (plan upload, grid, dashboard, export)
 * reads to learn an activity's plan + actual columns. It is FRAMEWORK-FREE — no react, no
 * next, no drizzle, no node built-ins — so it can be imported from both client and server
 * bundles (D-15). Only `import type` is used here.
 */

export type ActivityType = "measurement" | "item-list" | "status";

/**
 * Closed union of the column kinds present across the six PROJECT.md specs.
 * - `text`: free-form label / id / area name
 * - `number`: a measurement (sq ft, length, qty)
 * - `currency`: ₹ money (per-unit cost, total cost, line total)
 * - `date`: ISO date (execution date)
 * - `status`: workflow / issuance state
 * - `enum`: a fixed-choice picklist (label is in the FieldDef's enumValues)
 * - `lat` / `long`: geo coordinates entered as decimal strings (PITFALLS: keep as text)
 */
export type FieldKind =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "status"
  | "enum"
  | "lat"
  | "long";

/**
 * One column of a plan or actual sheet.
 * - `shared: true` marks the who/where columns that map to REAL indexed columns on
 *   `plan_rows` (region/state/district/taluka/distributor/dealer/sfid). Phase-2 import
 *   uses this flag to route the value to a real column vs the jsonb `fields` tail.
 * - `computeFrom`: declarative — names the source FieldDef keys an app-side calc reads
 *   to derive this column's value (e.g. totalCost computeFrom ['actualSqft','perUnitCost']).
 *   No formula code lives here; consumers compute.
 */
export type FieldDef = {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly shared?: boolean;
  readonly required?: boolean;
  readonly enumValues?: readonly string[];
  readonly computeFrom?: readonly string[];
};

/**
 * The six activity keys, exactly as registered. Adding a seventh is a single config
 * entry under one new key (ACTV-03) — the registry's resolver is by-key lookup, so no
 * resolver/loop/switch edit is required.
 */
export type ActivityKey =
  | "counter-wall"
  | "gsb"
  | "nlb"
  | "in-shop"
  | "pop-dealer-kit"
  | "dealer-certificate";

/**
 * One config entry — declares an activity's plan and actual column shape and its type
 * discriminator. POP/Dealer Kit's `actualColumns` describes ONE line-item shape; consumers
 * render the multi-item popup over it (Phase 3).
 */
export type ActivityConfig = {
  readonly key: ActivityKey;
  readonly label: string;
  readonly type: ActivityType;
  readonly planColumns: readonly FieldDef[];
  readonly actualColumns: readonly FieldDef[];
};
