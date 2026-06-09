# Design — Dashboard Breakdown, Adhoc Expenses tab, Filter dropdowns

**Date:** 2026-06-09
**Branch base:** `gsd/phase-4-compliance-dashboard` (Phase 4 dashboard work, not yet merged to master)
**Author:** brainstorming session with user

## Goal

Three product changes layered on top of the just-shipped Phase 4 dashboard:

1. **Dashboard breakdown** — add State-wise and Distributor-wise summaries, with planned/actual counters and planned/actual sq ft for Inshop Branding and Counter Wall Painting.
2. **Adhoc expenses** — a new tab inside `/actuals` for expenses that aren't tied to a plan-row SFID.
3. **Filter UX** — replace the always-expanded `<select multiple>` listboxes with proper popover-style multi-select dropdowns, on both the actuals filter bar and the dashboard filter bar.

## Non-Goals

- No new auth model — adhoc expenses use the same shared-password session as everything else.
- No budget-header taxonomy — kept as free text in v1 (can be promoted to a configured list later).
- No off-plan-guard relaxation — adhoc expenses live in their own table; the `executions → plan_rows` FK invariant is untouched.

---

## 1. Adhoc Expenses Tab

### Data model

New Drizzle table `adhoc_expenses` (new migration):

```ts
adhocExpenses = pgTable("adhoc_expenses", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  periodId: bigint("period_id", { mode: "number" })
    .notNull()
    .references(() => periods.id),
  region: text("region"),
  state: text("state"),
  district: text("district"),
  taluka: text("taluka"),
  activity: text("activity"),               // free text, with typeahead from the activity registry
  activityDate: date("activity_date"),
  budgetHeader: text("budget_header"),      // free text in v1
  expenseAmount: numeric("expense_amount", { precision: 14, scale: 2 }), // ex-GST
  vendorName: text("vendor_name"),
  remarks: text("remarks"),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("adhoc_expenses_period_idx").on(t.periodId),
]);
```

- **`month_of_activity` is NOT stored** — derived at render time from `activityDate` as `format(activityDate, 'MMM yyyy')`. Single source of truth.
- No SFID, no FK to `plan_rows`. By design.
- `version` enables the same optimistic-concurrency save pattern used in `executions`.

### UI

- Wrap the current `/actuals` page body in a tab strip: `[ Plan Actuals ] [ Adhoc Expenses ]`.
- Both tabs share the existing period switcher at the top of the page.
- Adhoc tab renders its own AG Grid (editable, paste-friendly, AG Grid Community), with a save-bar mirroring the existing one.
- Activity column uses a cell editor that suggests configured activities from the registry but accepts free text (one-off events are common in adhoc spend).
- Excel export button per tab — SheetJS, server-side, exports the current period's filtered view.

### Server

- New Server Action `saveAdhocExpenses(periodId, rows)` with Zod validation (`activityDate` parses DD/MM/YY, `expenseAmount` is `numeric(14,2)`, etc.).
- New DAL helpers `listAdhocExpenses(periodId, filters)` and `upsertAdhocExpenses(rows)`.
- `revalidatePath("/actuals")` after save.

---

## 2. Dashboard Breakdown Card

### Replaces

- `by-region-card.tsx` (folded into the new card as the Region tab? — open: **see Decisions Deferred**)
- `by-activity-card.tsx` (folded in as the Activity tab)

### New component

`app/(app)/dashboard/breakdown-card.tsx` — one card, tab strip:

```
[ State ] [ Distributor ] [ Activity ]   (Region optional 4th tab — see Decisions Deferred)
```

### Columns (identical across tabs; the group key changes)

| Group | Planned ₹ | Actual ₹ | % Spent | Planned Counters | Actual Counters | % Executed | Planned Sq Ft | Actual Sq Ft | % Sq Ft |

**Counter / sq-ft semantics:**
- **Counters** = row counts. Planned = `COUNT(plan_rows)` grouped by the tab key. Actual = `COUNT(executions WHERE status = 'completed')` (matches today's % Executed).
- **Sq ft** = `SUM(plan_rows.fields->>'<key>')::numeric` (planned) and `SUM(executions.total_sqft)` (actual). The exact jsonb key is TBD — confirmed at plan time by inspecting a real plan-upload row. Likely `plannedSqft` or `sqft`.
- **Counter and Sq Ft columns are populated only for Inshop Branding + Counter Wall Painting.** On the State and Distributor tabs, the counter / sq ft columns aggregate ONLY across those two activities; the ₹ columns aggregate across all activities. For other activities those cells render `—`. Column header tooltips call this out.

### DAL

Two new helpers in the dashboard data layer (mirroring the existing `byActivity` / `byRegion` SQL shapes — single grouped query, no N+1):

- `breakdownByState(periodId, filters)`
- `breakdownByDistributor(periodId, filters)`

### Interaction

- Honors the existing dashboard FilterBar (region / activity / period / rolling-N).
- Client-side sortable on each column (small N — states ≤ 30, distributors at most a few hundred).

---

## 3. Filter Dropdowns

### Scope

Replaces the current `<select multiple size={5}>` listboxes on:
- `app/(app)/actuals/filter-bar.tsx`
- `app/(app)/dashboard/dashboard-filter-bar.tsx`

Both filter bars converge on a single new component so we don't keep two implementations.

### Component

`components/multi-select-popover.tsx`:

```tsx
<MultiSelectPopover
  label="Region"
  options={["North","South",…]}
  selected={selected.region ?? []}
  onChange={(next) => …}
  disabled={options.length === 0}
/>
```

Renders as a button: `Region` / `Region (2)` / `Region: All` depending on selection state. Click → shadcn `Popover` containing a shadcn `Command` (search input + scrollable checkbox list + "Select all" / "Clear" actions).

### Behavior

- Selection toggles **instantly** — no apply button — matching today's UX.
- Cascade is unchanged: changing region clears state & district; changing state clears district. Parent owns the cascade logic; the popover is dumb.
- Empty facet (zero options for the current cascade): button is disabled and shows `—`.
- Long lists (N > 50): the inner list virtualizes (shadcn's `Command` uses `cmdk` which can be paired with `react-virtualized-cmdk` or a simple inline virtualizer — implementation detail at plan time).
- Keyboard nav comes from shadcn `Command` for free.

### Out of scope

- Facet data layer (`optionsFor`, `FacetSelections` in `lib/actuals/filter.ts`) — unchanged.
- AG Grid external filter callbacks — unchanged.
- The SFID search input — unchanged (it's already a single text input).

---

## Decisions Deferred to Plan Time

1. **Region tab in Breakdown card.** Retire `by-region-card.tsx` outright (Region becomes a tab in the new Breakdown card), or keep the existing Region card and let the Breakdown card have only State/Distributor/Activity? Default at plan time: **retire it** to avoid duplicated info, unless layout/UX review prefers keeping the at-a-glance region card separate.
2. **Planned sq ft jsonb key on `plan_rows.fields`.** Confirm by inspecting an uploaded plan row at plan time; update the DAL helper accordingly.
3. **Activity column on the Adhoc grid.** Free-text-with-typeahead or strict dropdown? Defaulting to free-text-with-typeahead from the activity registry, since adhoc spend is often a one-off event that doesn't match a registered activity.

## Testing

- Drizzle migration applied to a Neon branch first; smoke test the new table accepts inserts.
- Unit tests for the new DAL helpers (`breakdownByState`, `breakdownByDistributor`, `listAdhocExpenses`).
- Unit tests for `saveAdhocExpenses` Zod schema (date parsing, numeric precision, required fields).
- Playwright e2e:
  - Adhoc tab — add a row, save, reload, row persists.
  - Breakdown card — tabs switch, filters narrow rows.
  - Filter popover — open, search, toggle a value, see the grid filter.

## Migration / Rollout

- New migration adds `adhoc_expenses` only — no destructive schema changes elsewhere.
- The filter component swap is purely presentational; existing facet selections, URL state, and external-filter callbacks are preserved.
- Old `by-region-card.tsx` / `by-activity-card.tsx` removed in the same PR that adds `breakdown-card.tsx` (clean cut, no dead code left behind).
