# Phase 3: Actuals Grid - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-05
**Phase:** 3-Actuals-Grid
**Areas discussed:** Multi-unit entry, Filter/search/scale (Saving & conflicts and POP multi-item: defaults accepted without deep-dive)

---

## Gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-unit entry | How multiple executions per dealer are entered & shown | ✓ |
| Saving & conflicts | Save model + version-conflict handling on the shared login | |
| POP multi-item | The POP/Dealer-Kit popup and rollup | |
| Filter, search & scale | Filtering UI, cascading geography, status values, row scale | ✓ |

**User's choice:** Multi-unit entry + Filter/search/scale.
**Notes:** Skipped areas were later locked with Claude's proposed defaults (see final selection).

---

## Multi-unit entry

### Display / entry model

| Option | Description | Selected |
|--------|-------------|----------|
| Flat rows per unit | One grid row per execution unit, sorted under each dealer; plan cols read-only & repeated; "+ add unit" clones context. Community-only. | ✓ |
| Row per dealer + drawer | Grid stays one row per dealer (rollups); side panel lists units. | |
| Expandable dealer rows | Nested mini-table per dealer (custom — master-detail is Enterprise). | |

**User's choice:** Flat rows per unit.

### Initial view

| Option | Description | Selected |
|--------|-------------|----------|
| All planned dealers | Every planned dealer shows; zero-execution dealers appear as empty ready-to-fill rows. | ✓ |
| Only started dealers | Show only dealers with ≥1 execution; search/add to begin. | |

**User's choice:** All planned dealers.

### GSB/NLB sq ft formula

| Option | Description | Selected |
|--------|-------------|----------|
| Length × Breadth | Total Sq Ft = L × B; Height stored for reference only. | ✓ |
| L × B × H | Total Sq Ft = Length × Breadth × Height. | |

**User's choice:** Length × Breadth.

### Derived cells (read-only vs override)

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only (locked) | Derived totals computed and locked (matches GRID-04). | |
| Allow manual override | Auto-fill but allow overwrite when vendor billing differs. | ✓ |

**User's choice:** Allow manual override.
**Notes:** Captured as a deliberate softening of GRID-04's "read-only." Override is sticky per cell with a "reset to formula" affordance (D3-05); downstream verifier must not flag as a miss.

---

## Filter, search & scale

### Filter UI

| Option | Description | Selected |
|--------|-------------|----------|
| Filter bar + dropdowns | Custom multi-select dropdowns above the grid + SFID search (Set-Filter is Enterprise). | ✓ |
| AG Grid column filters | Built-in per-column text/floating filters. | |
| Both | Filter bar + column floating filters. | |

**User's choice:** Filter bar + dropdowns.

### Geography cascade

| Option | Description | Selected |
|--------|-------------|----------|
| Cascading | Region narrows State, State narrows District, etc. | ✓ |
| Independent | Each filter lists all values regardless of other picks. | |

**User's choice:** Cascading.

### Status vocabulary

| Option | Description | Selected |
|--------|-------------|----------|
| Pending / In Progress / Done | Three-state; Done = Issued for Dealer Certificate. | ✓ |
| Pending / Done | Two-state binary. | |
| Pending / In Progress / Done / Cancelled | Adds explicit Cancelled/NA. | |

**User's choice:** Pending / In Progress / Done.
**Notes:** Shared across all activities with a status field; added to the registry as `enumValues` (D3-09).

### Scale (client-side vs server-side)

| Option | Description | Selected |
|--------|-------------|----------|
| A few hundred (≤1k) | Load all rows client-side; filter in browser. | ✓ |
| 1k–10k | Still client-side; watch payload. | |
| 10k+ / not sure | Server-side filtering & paging on indexed columns. | |

**User's choice:** A few hundred (≤1k) → client-side load + filter.

---

## Final selection — skipped areas

| Option | Description | Selected |
|--------|-------------|----------|
| Discuss Saving & conflicts | Deep-dive the save model. | |
| Discuss POP multi-item | Deep-dive the POP popup. | |
| Lock defaults & write CONTEXT | Accept Claude's defaults for both, write CONTEXT.md. | ✓ |

**User's choice:** Lock defaults & write CONTEXT.
**Notes:** Saving defaults → batch-edit + explicit Save, per-unit `version`-blocked conflicts (D3-10..12). POP defaults → popup from a POP dealer row, one kit (execution) per dealer with N item-master line items rolled up (D3-13..15).

---

## Claude's Discretion

- AG Grid column/editor/renderer wiring; throwaway spike scope; routing (`/actuals` vs `/actuals/[activity]`) + nav entry.
- Sticky-override storage + "reset to formula" placement.
- "+ add unit" placement; repeated read-only plan-cell visual treatment.
- Delete-a-unit (recommend hard delete + confirm in v1).
- Cascading-dropdown derivation from loaded rows.
- Batch-vs-per-call patch action shape (batch array recommended).

## Deferred Ideas

- Server-side row model / paging (revisit at ~5–10k rows).
- True expandable master-detail rows (Enterprise / custom).
- Row-per-dealer + side-drawer UI (considered, not chosen).
- Multiple kits per POP dealer (v1 = one kit per dealer).
- Soft-void / audit trail for deleted units; audit of derived-total overrides.
- Period-over-period & saved/shareable filter views (v2 RPT-01/02).
