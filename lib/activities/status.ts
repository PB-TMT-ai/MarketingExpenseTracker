/**
 * Shared execution status vocabulary (P2-2).
 *
 * Previously this list was duplicated verbatim across five activity configs
 * (counter-wall, gsb, nlb, in-shop, dealer-certificate). Centralizing it here
 * removes the DRY hazard (one edit, all activities) and gives the grid + the
 * GridStats counter a single source of truth.
 *
 * "Cancelled" is a TERMINAL, not-done state — a dealer that withdrew, a site
 * that fell through. It lets a reviewer close a row honestly instead of parking
 * it in "Pending" forever, which would otherwise inflate the "to record" count.
 * GridStats counts it separately and excludes it from the % done denominator.
 *
 * Framework-free (matches types.ts): no react/next/drizzle. A plain const array
 * importable from both client and server bundles.
 */
export const STATUS_VALUES = [
  "Pending",
  "In Progress",
  "Done",
  "Cancelled",
] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];

/** Statuses that mean "this row no longer needs work" — done or cancelled. */
export const TERMINAL_STATUSES: readonly StatusValue[] = ["Done", "Cancelled"];
