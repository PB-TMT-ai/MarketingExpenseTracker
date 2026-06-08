/**
 * Status registry — the SINGLE SOURCE OF TRUTH for status classification across
 * the grid (Phase 3.1), the dashboard (Phase 4), and the export (Phase 5).
 *
 * PURE module — no React, no Drizzle, no DB. Importable from client and server.
 *
 * Closes A4/R1: Phase 4 SQL hardcodes the literal `'Cancelled'` in
 * `filter (where status = 'Cancelled')` aggregates. Without `'Cancelled'` in
 * STATUS_VALUES, a row cannot legally carry that status — and the aggregate
 * silently returns zero. Centralising the constant here, and forcing every
 * status-bearing activity config to consume it, makes drift mechanically
 * impossible.
 *
 * Order matters:
 *   - `Pending` first (the default for a freshly-inserted execution; D3.1-03).
 *   - `Cancelled` last (terminal AND newest; tooling that derives terminals from
 *     the tail keeps working).
 */

export const STATUS_VALUES = ["Pending", "In Progress", "Done", "Cancelled"] as const;

/**
 * Terminal statuses — the two end states an execution can reach.
 * Used by the dashboard (D-02/D-03) and the grid lock-on-Done regression guard.
 */
export const TERMINAL_STATUSES = ["Done", "Cancelled"] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];
