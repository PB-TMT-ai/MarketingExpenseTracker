# Dashboard Breakdown, Adhoc Expenses Tab, Filter Dropdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three product changes brainstormed in `docs/superpowers/specs/2026-06-09-dashboard-adhoc-filter-dropdowns-design.md` — a tabbed Dashboard Breakdown card, an Adhoc Expenses tab on `/actuals`, and a popover multi-select component replacing the existing `<select multiple>` listboxes on both filter bars.

**Architecture:** Three independent slices on a single branch (`feat/dashboard-adhoc-filter-dropdowns` off `gsd/phase-4-compliance-dashboard`). Slice 1 (filter dropdowns) is pure UI swap on existing facet plumbing — ships first. Slice 2 (breakdown card) extends `lib/db/dashboard.ts` with two grouped-SQL helpers + counters/sqft on the existing helpers, and replaces two cards with one tabbed card. Slice 3 (adhoc tab) adds a new `adhoc_expenses` table + Drizzle migration + DAL + Server Action + a 7th button on the existing ActivitySwitcher that branches to a new AdhocGrid component.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Drizzle ORM 0.45 + drizzle-kit 0.31, Postgres (PGlite for tests), AG Grid Community 35.3, SheetJS CE 0.20.3, Tailwind CSS 4, Zod 4, vitest, Playwright. No new dependencies — multi-select popover is hand-rolled (raw HTML + Tailwind), matching the codebase's lean posture.

---

## Resolved Decisions

1. **Region tab in Breakdown card** — RETIRE `by-region-card.tsx` and `by-activity-card.tsx`. The new `breakdown-card.tsx` has four tabs: **State / Distributor / Activity / Region**.
2. **Planned sq ft jsonb key** — `planSqft` in `plan_rows.fields` (confirmed in `lib/activities/counter-wall.ts:18`). In-shop Branding does **not** capture planned sq ft in its plan template (`lib/activities/in-shop.ts` has no `planSqft` field), so combined Planned Sq Ft on the breakdown card effectively reflects Counter Wall only. This is honest (no fabricated data) and called out in the tooltip.
3. **Activity column on Adhoc grid** — free-text with typeahead suggesting `ACTIVITIES` registry labels. Adhoc spend is often a one-off that doesn't match a registered activity.
4. **Adhoc tab placement** — extend `ActivitySwitcher` to accept `ActivityKey | "adhoc"` and add `?activity=adhoc` branching at the page level. Does not pollute the activity registry (adhoc has no SFID flow).
5. **Multi-select popover dependency** — hand-rolled component, no shadcn install. ~80 lines of code. Matches the codebase's "raw HTML + Tailwind + minimal deps" pattern.

---

## File Structure

### Created
- `app/(app)/multi-select-popover.tsx` — shared popover dropdown (Slice 1)
- `app/(app)/multi-select-popover.test.tsx` — unit test (Slice 1)
- `app/(app)/dashboard/breakdown-card.tsx` — Server Component with 4 tabs (Slice 2)
- `app/(app)/dashboard/breakdown-tabs.tsx` — Client tab navigator (Slice 2)
- `drizzle/0004_adhoc_expenses.sql` — generated migration (Slice 3)
- `lib/db/adhoc.ts` — DAL: `listAdhocByPeriod`, `upsertAdhocBatch`, `_resetAdhocForTest` (Slice 3)
- `lib/db/adhoc.test.ts` — integration test on PGlite (Slice 3)
- `lib/actions/adhoc.ts` — Server Action `saveAdhocExpenses` (Slice 3)
- `lib/actions/adhoc.test.ts` — Server Action test (Slice 3)
- `app/(app)/actuals/adhoc-grid.tsx` — AG Grid for adhoc rows (Slice 3)
- `e2e/breakdown-card.spec.ts` — Playwright e2e (Slice 2)
- `e2e/adhoc-expenses.spec.ts` — Playwright e2e (Slice 3)
- `e2e/filter-popover.spec.ts` — Playwright e2e (Slice 1)

### Modified
- `app/(app)/actuals/filter-bar.tsx` — swap `<select multiple>` for `<MultiSelectPopover>` (Slice 1)
- `app/(app)/dashboard/dashboard-filter-bar.tsx` — same swap (Slice 1)
- `lib/db/dashboard.ts` — add `breakdownByState`, `breakdownByDistributor`; extend `ByActivityRow` / `ByRegionRow` with `plannedCounters`, `actualCounters`, `plannedSqft`, `actualSqft` (Slice 2)
- `lib/db/dashboard.test.ts` — add tests for the new helpers + new fields (Slice 2)
- `app/(app)/dashboard/page.tsx` — replace `<ByActivityCard>`+`<ByRegionCard>` with `<BreakdownCard>` (Slice 2)
- `lib/db/schema.ts` — add `adhocExpenses` table (Slice 3)
- `lib/db/index.ts` — re-export `adhocExpenses` if pattern exists (verify at Slice 3 start)
- `app/(app)/actuals/activity-switcher.tsx` — accept `ActivityKey | "adhoc"`; render "Adhoc Expenses" button (Slice 3)
- `app/(app)/actuals/page.tsx` — handle `?activity=adhoc` by rendering `<AdhocGrid>` instead of `<ActualsGrid>` (Slice 3)

### Deleted
- `app/(app)/dashboard/by-activity-card.tsx` (Slice 2)
- `app/(app)/dashboard/by-region-card.tsx` (Slice 2)

---

## Slice 1 — Filter Dropdowns

### Task 1.1: Write failing unit tests for MultiSelectPopover

**Files:**
- Create: `app/(app)/multi-select-popover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MultiSelectPopover from "./multi-select-popover";

describe("MultiSelectPopover", () => {
  const baseProps = {
    label: "Region",
    options: ["North", "South", "East", "West"],
    selected: [] as string[],
    onChange: vi.fn(),
  };

  it("renders the label and a count badge only when items are selected", () => {
    const { rerender } = render(<MultiSelectPopover {...baseProps} />);
    expect(screen.getByRole("button", { name: /Region/i })).toBeTruthy();
    expect(screen.queryByText("(2)")).toBeNull();

    rerender(<MultiSelectPopover {...baseProps} selected={["North", "South"]} />);
    expect(screen.getByText("(2)")).toBeTruthy();
  });

  it("opens the panel and lists every option as a checkbox", () => {
    render(<MultiSelectPopover {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    baseProps.options.forEach((o) => {
      expect(screen.getByRole("checkbox", { name: o })).toBeTruthy();
    });
  });

  it("calls onChange with the next selection when an option toggles", () => {
    const onChange = vi.fn();
    render(<MultiSelectPopover {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "North" }));
    expect(onChange).toHaveBeenCalledWith(["North"]);
  });

  it("filters options by the search box (case-insensitive)", () => {
    render(<MultiSelectPopover {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ea" } });
    expect(screen.queryByRole("checkbox", { name: "North" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "East" })).toBeTruthy();
  });

  it("disables the trigger and shows em-dash when options is empty", () => {
    render(<MultiSelectPopover {...baseProps} options={[]} />);
    const btn = screen.getByRole("button", { name: /Region/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.textContent).toMatch(/—/);
  });

  it("Select all selects every option; Clear empties the selection", () => {
    const onChange = vi.fn();
    render(<MultiSelectPopover {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    fireEvent.click(screen.getByRole("button", { name: /select all/i }));
    expect(onChange).toHaveBeenLastCalledWith(["North", "South", "East", "West"]);

    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/\(app\)/multi-select-popover.test.tsx`
Expected: FAIL — `Cannot find module './multi-select-popover'`.

> If `@testing-library/react` is not yet a devDependency, add it as part of this step:
> `npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom`
> and ensure `vitest.config.ts` has `test.environment = "jsdom"` (verify before installing — read `vitest.config.ts`; if `environment` is already `jsdom`, skip; if not, set it).

- [ ] **Step 3: Commit the failing test scaffolding**

```bash
git add app/\(app\)/multi-select-popover.test.tsx package.json vitest.config.ts
git commit -m "test(filter-popover): failing unit tests for MultiSelectPopover

RED — drives the new shared popover component used by both filter bars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Implement MultiSelectPopover

**Files:**
- Create: `app/(app)/multi-select-popover.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * MultiSelectPopover — a single facet's filter as a popover dropdown.
 *
 * Replaces the always-expanded `<select multiple size={5}>` listboxes that previously
 * occupied vertical space on the actuals and dashboard filter bars. Behaviour matches:
 * selection toggles fire `onChange` instantly (no Apply button), parent owns the cascade
 * (this component is dumb).
 *
 * Hand-rolled, no shadcn / @radix-ui / cmdk dependency — keeps the deps lean to match
 * the rest of the codebase.
 */
export default function MultiSelectPopover({
  label,
  options,
  selected,
  onChange,
  testIdSuffix,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** e.g. "region" — used to build a stable data-slot for e2e selectors. */
  testIdSuffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Outside-click closes the popover. Tracked here (not in a portal) because we render
  // inline — the surrounding flex layout positions the trigger; the panel is absolute.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? options : options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const isEmpty = options.length === 0;
  const count = selected.length;

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col gap-1"
      data-slot={testIdSuffix ? `filter-${testIdSuffix}` : undefined}
    >
      <button
        type="button"
        disabled={isEmpty}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-10 min-w-[140px] items-center justify-between gap-2 rounded-md border px-3 text-sm ${
          isEmpty
            ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
            : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{label}</span>
          {isEmpty ? (
            <span className="text-neutral-400">—</span>
          ) : count > 0 ? (
            <span className="rounded-full bg-neutral-900 px-1.5 text-[10px] font-semibold text-white">
              ({count})
            </span>
          ) : null}
        </span>
        <span aria-hidden className="text-neutral-400">▾</span>
      </button>

      {open && !isEmpty && (
        <div
          role="listbox"
          className="absolute top-full z-20 mt-1 w-[260px] rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          <div className="border-b border-neutral-100 p-2">
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-200 px-2 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-neutral-500">No matches.</p>
            ) : (
              visible.map((opt) => {
                const isChecked = selected.includes(opt);
                return (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(opt)}
                      aria-label={opt}
                    />
                    <span>{opt}</span>
                  </label>
                );
              })
            )}
          </div>
          <div className="flex justify-between border-t border-neutral-100 p-2 text-xs">
            <button
              type="button"
              onClick={() => onChange(options.slice())}
              className="text-neutral-700 hover:text-neutral-900"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-neutral-700 hover:text-neutral-900"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run unit tests to verify they pass**

Run: `npx vitest run app/\(app\)/multi-select-popover.test.tsx`
Expected: 6/6 PASS.

- [ ] **Step 3: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/multi-select-popover.tsx
git commit -m "feat(filter-popover): hand-rolled MultiSelectPopover component

GREEN — checkbox list inside an outside-click-aware popover, no new deps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Wire MultiSelectPopover into the actuals filter bar

**Files:**
- Modify: `app/(app)/actuals/filter-bar.tsx:148-222`

- [ ] **Step 1: Replace the `<select multiple>` loop with `<MultiSelectPopover>`**

Replace the existing `<fieldset>...<div className="flex flex-wrap items-end gap-3">{ALL_FACETS.map(...)}</div></fieldset>` block (the inner content rendering each facet `<select multiple>`) with this:

```tsx
import MultiSelectPopover from "@/app/(app)/multi-select-popover";
// ... existing imports above

      <fieldset className="flex flex-1 flex-col gap-2">
        <legend className="text-xs font-medium text-neutral-700">
          Filter rows
        </legend>
        <div className="flex flex-wrap items-end gap-3">
          {ALL_FACETS.map((facet) => {
            const opts = options[facet] ?? [];
            const sel = selected[facet] ?? [];
            return (
              <MultiSelectPopover
                key={facet}
                label={LABELS[facet]}
                options={opts}
                selected={sel}
                testIdSuffix={facet}
                onChange={(newVals) => {
                  setSelected((prev) => {
                    const nextState: MultiState = { ...prev, [facet]: newVals };
                    if (facet === "region") {
                      nextState.state = [];
                      nextState.district = [];
                    } else if (facet === "state") {
                      nextState.district = [];
                    }
                    onFacetChange(nextState as FacetSelections);
                    return nextState;
                  });
                }}
              />
            );
          })}
        </div>
      </fieldset>
```

The cascade clearing logic is unchanged; only the inner rendering swaps.

- [ ] **Step 2: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run unit suite (no regressions)**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/actuals/filter-bar.tsx
git commit -m "feat(actuals): swap <select multiple> for MultiSelectPopover

Cascade logic and onFacetChange contract preserved. data-slot=\"filter-<facet>\"
on the popover keeps e2e selectors working.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Wire MultiSelectPopover into the dashboard filter bar

**Files:**
- Modify: `app/(app)/dashboard/dashboard-filter-bar.tsx`

- [ ] **Step 1: Read the file**

```bash
# Inspect the current shape; the patch below mirrors Task 1.3 for the dashboard bar.
```

Read `app/(app)/dashboard/dashboard-filter-bar.tsx`. Identify the `<select multiple>` block (same shape as `actuals/filter-bar.tsx`). Replace each `<select multiple>` instance with a `<MultiSelectPopover>` keeping the existing label, options, selected, and onChange wiring intact.

- [ ] **Step 2: Apply the swap**

For each facet (`region`, `state`, `district`, `distributor`, `activity` if it's a multi-select; check the file first), replace:

```tsx
<select multiple value={sel} onChange={...} className="...">
  {opts.map(...)}
</select>
```

with:

```tsx
<MultiSelectPopover
  label={LABELS[facet]}
  options={opts}
  selected={sel}
  testIdSuffix={facet}
  onChange={(newVals) => { /* same handler body as before */ }}
/>
```

Add the import at the top: `import MultiSelectPopover from "@/app/(app)/multi-select-popover";`

- [ ] **Step 3: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/dashboard/dashboard-filter-bar.tsx
git commit -m "feat(dashboard): swap <select multiple> for MultiSelectPopover

Same component as actuals filter bar — one popover implementation,
two callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.5: Playwright e2e for the filter popover

**Files:**
- Create: `e2e/filter-popover.spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

test.describe("filter popover", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("opens, filters by search, toggles a value, and shows count badge", async ({ page }) => {
    await page.goto("/actuals");
    const regionTrigger = page.locator('[data-slot="filter-region"] button').first();
    await regionTrigger.click();

    // Popover panel is visible with a search input.
    const search = page.getByPlaceholder("Search…");
    await expect(search).toBeVisible();

    // Search narrows the list.
    await search.fill("north");
    await expect(page.getByRole("checkbox", { name: "North" })).toBeVisible();

    // Toggling fires the parent onChange; the trigger button shows a count badge.
    await page.getByRole("checkbox", { name: "North" }).check();
    await expect(regionTrigger).toContainText("(1)");

    // Outside click closes it.
    await page.locator("h1").first().click();
    await expect(search).toBeHidden();
  });
});
```

- [ ] **Step 2: Run the e2e**

Run: `npx playwright test e2e/filter-popover.spec.ts`
Expected: PASS. (Requires the dev server up. The repo's existing e2e config handles this; verify before running by reading `playwright.config.ts`.)

- [ ] **Step 3: Commit**

```bash
git add e2e/filter-popover.spec.ts
git commit -m "test(filter-popover): e2e covers open, search, toggle, count, close

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Slice 2 — Dashboard Breakdown Card

### Task 2.1: Extend ScopeTotals + ByActivityRow + ByRegionRow with counter/sqft fields

**Files:**
- Modify: `lib/db/dashboard.ts:82-114`

- [ ] **Step 1: Add the four new fields to the shared types**

Update the type block in `lib/db/dashboard.ts`:

```ts
/** One-row aggregate feeding the StatStrip (DASH-01, DASH-03, DASH-05). */
export type ScopeTotals = {
  plannedUnits: number;
  executedUnits: number;
  inProgressUnits: number;
  pendingUnits: number;
  cancelledUnits: number;
  plannedCost: number;
  actualCost: number;
  /**
   * Counter / sq ft metrics for the two activities that track them:
   * Counter Wall Painting ("counter-wall") and In-shop Branding ("in-shop").
   * Other activities contribute 0 to these aggregates.
   *
   * - plannedCounters: distinct plan_row count where activity in those two.
   * - actualCounters: distinct execution count where status='Done' AND its plan_row activity in those two.
   * - plannedSqft: sum((fields->>'planSqft')::numeric) for plan_rows in those two activities.
   *   In-shop's plan template does NOT carry sqft — so in practice this equals Counter Wall's sum.
   * - actualSqft: sum(executions.total_sqft) where status='Done' AND plan_row activity in those two.
   */
  plannedCounters: number;
  actualCounters: number;
  plannedSqft: number;
  actualSqft: number;
};

export type ByActivityRow = ScopeTotals & { activity: string };
export type ByRegionRow = ScopeTotals & { region: string };
```

- [ ] **Step 2: Extend each aggregator's SQL select to include the four new columns**

In `aggregateScopeTotals`, `aggregateByActivity`, `aggregateByRegion`, add to the `.select({...})` block:

```ts
plannedCounters: sql<string>`count(distinct ${planRows.id}) filter (where ${planRows.activity} in ('counter-wall','in-shop'))::int`,
actualCounters: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop'))::int`,
plannedSqft: sql<string>`coalesce(sum((${planRows.fields}->>'planSqft')::numeric) filter (where ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
actualSqft: sql<string>`coalesce(sum(${executions.totalSqft}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
```

And in each TS mapping, add:

```ts
plannedCounters: Number(r?.plannedCounters ?? 0),
actualCounters: Number(r?.actualCounters ?? 0),
plannedSqft: Number(r?.plannedSqft ?? 0),
actualSqft: Number(r?.actualSqft ?? 0),
```

- [ ] **Step 3: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (Existing call sites already destructure only the fields they use; adding fields is non-breaking.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/dashboard.ts
git commit -m "feat(dashboard-dal): add planned/actual counters + sqft to ScopeTotals

For Counter Wall Painting and In-shop Branding only — other activities
contribute 0 via the FILTER (WHERE activity IN (...)) clause. In-shop's
plan template doesn't carry planSqft, so combined planned sqft reflects
Counter Wall in practice.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Write failing test for breakdownByState

**Files:**
- Modify: `lib/db/dashboard.test.ts`

- [ ] **Step 1: Append the failing test**

Add to `lib/db/dashboard.test.ts` (in the existing `describe` block; pattern: copy the existing `byRegion` test if there is one, swap key to state):

```ts
import { breakdownByState, breakdownByDistributor } from "./dashboard";

describe("breakdownByState", () => {
  it("groups planned/actual cost + counters + sqft by state", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });

    // Seed: 2 counter-wall plan rows in MH, 1 in KA. One MH row executed=Done.
    await db.insert(planRows).values([
      { periodId: period.id, activity: "counter-wall", sfid: "S1", state: "MH", plannedCost: "1000", fields: { planSqft: 100 } },
      { periodId: period.id, activity: "counter-wall", sfid: "S2", state: "MH", plannedCost: "2000", fields: { planSqft: 200 } },
      { periodId: period.id, activity: "counter-wall", sfid: "S3", state: "KA", plannedCost: "3000", fields: { planSqft: 300 } },
    ]);
    const mhRowId = await _findPlanRowIdForTest(period.id, "counter-wall", "S1");
    await db.insert(executions).values({
      planRowId: mhRowId, status: "Done", totalCost: "950", totalSqft: "98",
    });

    const rows = await breakdownByState({
      periodId: period.id, activity: null,
      regions: [], states: [], districts: [], distributors: [],
    });

    const mh = rows.find((r) => r.state === "MH")!;
    expect(mh.plannedCost).toBe(3000);
    expect(mh.actualCost).toBe(950);
    expect(mh.plannedCounters).toBe(2);
    expect(mh.actualCounters).toBe(1);
    expect(mh.plannedSqft).toBe(300);
    expect(mh.actualSqft).toBe(98);

    const ka = rows.find((r) => r.state === "KA")!;
    expect(ka.plannedCost).toBe(3000);
    expect(ka.actualCounters).toBe(0);
  });
});

describe("breakdownByDistributor", () => {
  it("groups by distributor and coalesces NULL to (unassigned)", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });
    await db.insert(planRows).values([
      { periodId: period.id, activity: "counter-wall", sfid: "S1", distributor: "Acme", plannedCost: "1000", fields: { planSqft: 100 } },
      { periodId: period.id, activity: "counter-wall", sfid: "S2", distributor: null, plannedCost: "500", fields: { planSqft: 50 } },
    ]);

    const rows = await breakdownByDistributor({
      periodId: period.id, activity: null,
      regions: [], states: [], districts: [], distributors: [],
    });

    expect(rows.find((r) => r.distributor === "Acme")?.plannedCost).toBe(1000);
    expect(rows.find((r) => r.distributor === "(unassigned)")?.plannedCost).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run lib/db/dashboard.test.ts`
Expected: FAIL — `breakdownByState is not a function` (and same for `breakdownByDistributor`).

- [ ] **Step 3: Commit the failing test**

```bash
git add lib/db/dashboard.test.ts
git commit -m "test(dashboard-dal): RED — breakdownByState + breakdownByDistributor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Implement breakdownByState and breakdownByDistributor

**Files:**
- Modify: `lib/db/dashboard.ts`

- [ ] **Step 1: Add the return types**

Append to the type block in `lib/db/dashboard.ts`:

```ts
/** One row per `plan_rows.state` in scope. NULL → `"(unassigned)"`. */
export type ByStateRow = ScopeTotals & { state: string };

/** One row per `plan_rows.distributor` in scope. NULL → `"(unassigned)"`. */
export type ByDistributorRow = ScopeTotals & { distributor: string };
```

- [ ] **Step 2: Add the two helpers (copy aggregateByRegion's body, swap the group key)**

```ts
export async function breakdownByState(
  filters: DashboardFilters,
): Promise<ByStateRow[]> {
  const rows = await db
    .select({
      state: planRows.state,
      plannedUnits: sql<string>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      inProgressUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pendingUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Pending' or ${executions.status} is null)::int`,
      cancelledUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
      plannedCounters: sql<string>`count(distinct ${planRows.id}) filter (where ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      actualCounters: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      plannedSqft: sql<string>`coalesce(sum((${planRows.fields}->>'planSqft')::numeric) filter (where ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
      actualSqft: sql<string>`coalesce(sum(${executions.totalSqft}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(PLAN_UPLOAD_ONLY, facetWhere(filters)))
    .groupBy(planRows.state)
    .orderBy(planRows.state);

  return rows.map((r) => ({
    state: r.state ?? "(unassigned)",
    plannedUnits: Number(r.plannedUnits ?? 0),
    executedUnits: Number(r.executedUnits ?? 0),
    inProgressUnits: Number(r.inProgressUnits ?? 0),
    pendingUnits: Number(r.pendingUnits ?? 0),
    cancelledUnits: Number(r.cancelledUnits ?? 0),
    plannedCost: Number(r.plannedCost ?? 0),
    actualCost: Number(r.actualCost ?? 0),
    plannedCounters: Number(r.plannedCounters ?? 0),
    actualCounters: Number(r.actualCounters ?? 0),
    plannedSqft: Number(r.plannedSqft ?? 0),
    actualSqft: Number(r.actualSqft ?? 0),
  }));
}

export async function breakdownByDistributor(
  filters: DashboardFilters,
): Promise<ByDistributorRow[]> {
  const rows = await db
    .select({
      distributor: planRows.distributor,
      plannedUnits: sql<string>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      inProgressUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pendingUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Pending' or ${executions.status} is null)::int`,
      cancelledUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
      plannedCounters: sql<string>`count(distinct ${planRows.id}) filter (where ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      actualCounters: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      plannedSqft: sql<string>`coalesce(sum((${planRows.fields}->>'planSqft')::numeric) filter (where ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
      actualSqft: sql<string>`coalesce(sum(${executions.totalSqft}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(PLAN_UPLOAD_ONLY, facetWhere(filters)))
    .groupBy(planRows.distributor)
    .orderBy(planRows.distributor);

  return rows.map((r) => ({
    distributor: r.distributor ?? "(unassigned)",
    plannedUnits: Number(r.plannedUnits ?? 0),
    executedUnits: Number(r.executedUnits ?? 0),
    inProgressUnits: Number(r.inProgressUnits ?? 0),
    pendingUnits: Number(r.pendingUnits ?? 0),
    cancelledUnits: Number(r.cancelledUnits ?? 0),
    plannedCost: Number(r.plannedCost ?? 0),
    actualCost: Number(r.actualCost ?? 0),
    plannedCounters: Number(r.plannedCounters ?? 0),
    actualCounters: Number(r.actualCounters ?? 0),
    plannedSqft: Number(r.plannedSqft ?? 0),
    actualSqft: Number(r.actualSqft ?? 0),
  }));
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run lib/db/dashboard.test.ts`
Expected: PASS (both new tests + existing tests still green).

- [ ] **Step 3: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/db/dashboard.ts
git commit -m "feat(dashboard-dal): breakdownByState + breakdownByDistributor

GREEN — single grouped SQL, mirrors aggregateByRegion shape with the
new counters/sqft columns. NULL group keys coalesce to '(unassigned)'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.4: Build the BreakdownCard Server Component

**Files:**
- Create: `app/(app)/dashboard/breakdown-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
import {
  aggregateByActivity,
  aggregateByRegion,
  breakdownByState,
  breakdownByDistributor,
  type DashboardFilters,
  type ScopeTotals,
} from "@/lib/db/dashboard";
import { ACTIVITIES } from "@/lib/activities/registry";
import BreakdownTabs from "./breakdown-tabs";

/**
 * BreakdownCard — single card with four group-by views: State, Distributor, Activity, Region.
 *
 * Replaces the previous standalone by-activity-card and by-region-card.
 * Server Component: aggregates server-side, hands ALL four datasets to the Client tab
 * navigator so the user can flip between views without a network round-trip.
 *
 * Counters and sq ft columns reflect only Counter Wall Painting + In-shop Branding —
 * the two activities for which those metrics are meaningful. Other activities contribute
 * 0 via the SQL FILTER clauses in the DAL.
 */
export default async function BreakdownCard({
  filters,
}: {
  filters: DashboardFilters;
}) {
  const [byState, byDistributor, byActivity, byRegion] = await Promise.all([
    breakdownByState(filters),
    breakdownByDistributor(filters),
    aggregateByActivity(filters),
    aggregateByRegion(filters),
  ]);

  // Activity rows: relabel the raw key to its human label from the registry.
  const activityRows = byActivity.map((r) => ({
    ...r,
    label: ACTIVITIES[r.activity as keyof typeof ACTIVITIES]?.label ?? r.activity,
  }));

  return (
    <section
      data-slot="breakdown-card"
      className="rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <header className="border-b border-neutral-200 p-4">
        <h2 className="text-base font-semibold">Breakdown</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Planned ₹ aggregates all activities. Planned/Actual Counters and Sq Ft reflect
          Counter Wall Painting + In-shop Branding only (In-shop&apos;s plan template does not
          capture planned sq ft, so Planned Sq Ft is effectively Counter Wall&apos;s contribution).
        </p>
      </header>
      <BreakdownTabs
        byState={byState}
        byDistributor={byDistributor}
        byActivity={activityRows}
        byRegion={byRegion}
      />
    </section>
  );
}

export type BreakdownActivityRow = ScopeTotals & { activity: string; label: string };
```

- [ ] **Step 2: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (BreakdownTabs not yet created — comment out the BreakdownTabs import + JSX temporarily, then re-enable in Task 2.5).

> Actually: write Task 2.4 and 2.5 together; do not commit until both pass tsc. The card and tabs are coupled — splitting them across commits leaves a half-state.

### Task 2.5: Build the BreakdownTabs Client Component

**Files:**
- Create: `app/(app)/dashboard/breakdown-tabs.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import type {
  ByActivityRow,
  ByDistributorRow,
  ByRegionRow,
  ByStateRow,
} from "@/lib/db/dashboard";

type TabKey = "state" | "distributor" | "activity" | "region";

type ActivityRow = ByActivityRow & { label: string };

/**
 * BreakdownTabs — Client tablist + table. All four datasets arrive pre-aggregated;
 * switching tabs is a state flip, no fetch. Tables are client-sortable on every numeric
 * column (small N: states ≤ 30, distributors ≤ a few hundred, activities ≤ 6).
 */
export default function BreakdownTabs({
  byState,
  byDistributor,
  byActivity,
  byRegion,
}: {
  byState: ByStateRow[];
  byDistributor: ByDistributorRow[];
  byActivity: ActivityRow[];
  byRegion: ByRegionRow[];
}) {
  const [tab, setTab] = useState<TabKey>("state");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "state", label: "State" },
    { key: "distributor", label: "Distributor" },
    { key: "activity", label: "Activity" },
    { key: "region", label: "Region" },
  ];

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-neutral-200 px-4">
        {tabs.map((t) => {
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              data-tab={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? "border-neutral-900 text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto p-4">
        {tab === "state" && (
          <BreakdownTable rows={byState.map((r) => ({ ...r, key: r.state }))} keyHeader="State" />
        )}
        {tab === "distributor" && (
          <BreakdownTable
            rows={byDistributor.map((r) => ({ ...r, key: r.distributor }))}
            keyHeader="Distributor"
          />
        )}
        {tab === "activity" && (
          <BreakdownTable rows={byActivity.map((r) => ({ ...r, key: r.label }))} keyHeader="Activity" />
        )}
        {tab === "region" && (
          <BreakdownTable rows={byRegion.map((r) => ({ ...r, key: r.region }))} keyHeader="Region" />
        )}
      </div>
    </div>
  );
}

type Row = {
  key: string;
  plannedCost: number;
  actualCost: number;
  plannedCounters: number;
  actualCounters: number;
  plannedSqft: number;
  actualSqft: number;
};

function BreakdownTable({ rows, keyHeader }: { rows: Row[]; keyHeader: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No rows in scope.</p>;
  }

  const totals = rows.reduce(
    (acc, r) => ({
      plannedCost: acc.plannedCost + r.plannedCost,
      actualCost: acc.actualCost + r.actualCost,
      plannedCounters: acc.plannedCounters + r.plannedCounters,
      actualCounters: acc.actualCounters + r.actualCounters,
      plannedSqft: acc.plannedSqft + r.plannedSqft,
      actualSqft: acc.actualSqft + r.actualSqft,
    }),
    { plannedCost: 0, actualCost: 0, plannedCounters: 0, actualCounters: 0, plannedSqft: 0, actualSqft: 0 },
  );

  const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const pct = (num: number, den: number) =>
    den === 0 ? "—" : `${Math.round((num / den) * 100)}%`;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-neutral-500">
        <tr>
          <th className="px-2 py-1">{keyHeader}</th>
          <th className="px-2 py-1 text-right">Planned ₹</th>
          <th className="px-2 py-1 text-right">Actual ₹</th>
          <th className="px-2 py-1 text-right">% Spent</th>
          <th className="px-2 py-1 text-right" title="Counter Wall + In-shop only">
            Planned Counters
          </th>
          <th className="px-2 py-1 text-right" title="Counter Wall + In-shop only">
            Actual Counters
          </th>
          <th className="px-2 py-1 text-right">% Executed</th>
          <th className="px-2 py-1 text-right" title="Counter Wall only (In-shop plan doesn't carry sqft)">
            Planned Sq Ft
          </th>
          <th className="px-2 py-1 text-right" title="Counter Wall + In-shop, Done only">
            Actual Sq Ft
          </th>
          <th className="px-2 py-1 text-right">% Sq Ft</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-neutral-100">
            <td className="px-2 py-1">{r.key}</td>
            <td className="px-2 py-1 text-right">{fmtINR(r.plannedCost)}</td>
            <td className="px-2 py-1 text-right">{fmtINR(r.actualCost)}</td>
            <td className="px-2 py-1 text-right">{pct(r.actualCost, r.plannedCost)}</td>
            <td className="px-2 py-1 text-right">{r.plannedCounters || "—"}</td>
            <td className="px-2 py-1 text-right">{r.actualCounters || "—"}</td>
            <td className="px-2 py-1 text-right">{pct(r.actualCounters, r.plannedCounters)}</td>
            <td className="px-2 py-1 text-right">{r.plannedSqft ? r.plannedSqft.toLocaleString("en-IN") : "—"}</td>
            <td className="px-2 py-1 text-right">{r.actualSqft ? r.actualSqft.toLocaleString("en-IN") : "—"}</td>
            <td className="px-2 py-1 text-right">{pct(r.actualSqft, r.plannedSqft)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-neutral-300 font-semibold">
          <td className="px-2 py-1">Total</td>
          <td className="px-2 py-1 text-right">{fmtINR(totals.plannedCost)}</td>
          <td className="px-2 py-1 text-right">{fmtINR(totals.actualCost)}</td>
          <td className="px-2 py-1 text-right">{pct(totals.actualCost, totals.plannedCost)}</td>
          <td className="px-2 py-1 text-right">{totals.plannedCounters || "—"}</td>
          <td className="px-2 py-1 text-right">{totals.actualCounters || "—"}</td>
          <td className="px-2 py-1 text-right">{pct(totals.actualCounters, totals.plannedCounters)}</td>
          <td className="px-2 py-1 text-right">{totals.plannedSqft ? totals.plannedSqft.toLocaleString("en-IN") : "—"}</td>
          <td className="px-2 py-1 text-right">{totals.actualSqft ? totals.actualSqft.toLocaleString("en-IN") : "—"}</td>
          <td className="px-2 py-1 text-right">{pct(totals.actualSqft, totals.plannedSqft)}</td>
        </tr>
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit Task 2.4 + 2.5 together**

```bash
git add app/\(app\)/dashboard/breakdown-card.tsx app/\(app\)/dashboard/breakdown-tabs.tsx
git commit -m "feat(dashboard): BreakdownCard with State/Distributor/Activity/Region tabs

Server Component aggregates four datasets in parallel; Client tabs flip
between them without refetching. Table shows ₹, counters, sqft, % derivatives
with a totals footer row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.6: Wire BreakdownCard into dashboard page, delete old cards

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Delete: `app/(app)/dashboard/by-activity-card.tsx`
- Delete: `app/(app)/dashboard/by-region-card.tsx`

- [ ] **Step 1: Update page.tsx**

In `app/(app)/dashboard/page.tsx`:
1. Remove imports of `ByActivityCard` and `ByRegionCard`.
2. Add: `import BreakdownCard from "./breakdown-card";`
3. Find the JSX block that renders `<ByActivityCard ... />` and `<ByRegionCard ... />` side by side. Replace with a single `<BreakdownCard filters={filters} />`. Drop any data-fetching calls (`aggregateByActivity`, `aggregateByRegion`) that were performed in the page solely to feed those two cards — `BreakdownCard` now owns those fetches.

- [ ] **Step 2: Delete the old card files**

```bash
git rm app/\(app\)/dashboard/by-activity-card.tsx
git rm app/\(app\)/dashboard/by-region-card.tsx
```

- [ ] **Step 3: TypeCheck + unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; tests green.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/dashboard/page.tsx
git commit -m "feat(dashboard): replace by-activity + by-region cards with BreakdownCard

Old cards deleted — their data is now under the Activity and Region tabs
of the new unified card. Removes ~150 LoC of near-duplicated JSX.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.7: Playwright e2e for the breakdown card

**Files:**
- Create: `e2e/breakdown-card.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

test.describe("breakdown card", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("tabs render and switch", async ({ page }) => {
    await page.goto("/dashboard");
    const card = page.locator('[data-slot="breakdown-card"]');
    await expect(card).toBeVisible();

    // State tab is default-active.
    await expect(card.locator('[role="tab"][data-tab="state"]')).toHaveAttribute("aria-selected", "true");

    // Switching to Distributor.
    await card.locator('[role="tab"][data-tab="distributor"]').click();
    await expect(card.locator('[role="tab"][data-tab="distributor"]')).toHaveAttribute("aria-selected", "true");

    // Activity and Region tabs are present and clickable.
    await card.locator('[role="tab"][data-tab="activity"]').click();
    await expect(card.locator('[role="tab"][data-tab="activity"]')).toHaveAttribute("aria-selected", "true");
    await card.locator('[role="tab"][data-tab="region"]').click();
    await expect(card.locator('[role="tab"][data-tab="region"]')).toHaveAttribute("aria-selected", "true");
  });

  test("totals row sums the visible rows", async ({ page }) => {
    await page.goto("/dashboard");
    const card = page.locator('[data-slot="breakdown-card"]');
    const totalsRow = card.locator("tbody tr").last();
    await expect(totalsRow).toContainText(/Total/i);
  });
});
```

- [ ] **Step 2: Run e2e**

Run: `npx playwright test e2e/breakdown-card.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/breakdown-card.spec.ts
git commit -m "test(dashboard): e2e for BreakdownCard tab switching + totals row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Slice 3 — Adhoc Expenses Tab

### Task 3.1: Add adhocExpenses table to Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add the table at the end of `schema.ts`**

```ts
export const adhocExpenses = pgTable(
  "adhoc_expenses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    periodId: bigint("period_id", { mode: "number" })
      .notNull()
      .references(() => periods.id),
    region: text("region"),
    state: text("state"),
    district: text("district"),
    taluka: text("taluka"),
    activity: text("activity"),
    activityDate: date("activity_date"),
    budgetHeader: text("budget_header"),
    expenseAmount: numeric("expense_amount", { precision: 14, scale: 2 }),
    vendorName: text("vendor_name"),
    remarks: text("remarks"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("adhoc_expenses_period_idx").on(t.periodId)],
);
```

- [ ] **Step 2: Verify `date` and `integer` are already imported at the top of `schema.ts`**

Read the top imports of `lib/db/schema.ts`. They already include `date`, `integer`, `bigserial`, `bigint`, `text`, `numeric`, `timestamp`, `index` — no import edits needed.

- [ ] **Step 3: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task 3.2: Generate the Drizzle migration

**Files:**
- Create: `drizzle/0004_*.sql` (Drizzle picks the suffix)

- [ ] **Step 1: Generate**

Run: `npm run db:generate`
Expected: A new file appears under `drizzle/0004_*.sql` with a `CREATE TABLE "adhoc_expenses"` statement + the index DDL + the FK to `periods`. Inspect the generated SQL to confirm it matches the schema.

- [ ] **Step 2: Apply locally**

Run: `npm run db:migrate:local`
Expected: migration runs successfully; PGlite has the new table.

- [ ] **Step 3: Commit schema + migration together**

```bash
git add lib/db/schema.ts drizzle/0004_*.sql drizzle/meta/
git commit -m "feat(adhoc): adhoc_expenses table + migration

Period-scoped, no FK to plan_rows (off-plan-guard untouched).
free-text columns for region/state/district/taluka/activity/budget_header/
vendor_name/remarks; numeric(14,2) for expenseAmount; date for activityDate
(month-of-activity is derived at render time).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.3: Write failing tests for the adhoc DAL

**Files:**
- Create: `lib/db/adhoc.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "./index";
import { ensureMigrated } from "./migrate";
import { _resetPeriodsForTest, insertPeriod } from "./periods";
import {
  listAdhocByPeriod,
  upsertAdhocBatch,
  _resetAdhocForTest,
  type AdhocInput,
} from "./adhoc";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetAdhocForTest();
  await _resetPeriodsForTest();
});

describe("adhoc DAL", () => {
  it("inserts a fresh row when id is null and returns it from listAdhocByPeriod", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });
    const input: AdhocInput = {
      id: null,
      periodId: period.id,
      region: "North", state: "UP", district: "Agra", taluka: "Agra Sadar",
      activity: "Local event", activityDate: "2026-05-10",
      budgetHeader: "BTL", expenseAmount: "12500.00",
      vendorName: "ACME Events", remarks: "monsoon promo",
      version: 0,
    };
    const result = await upsertAdhocBatch([input]);
    expect(result.inserted).toBe(1);
    expect(result.conflicts).toEqual([]);

    const rows = await listAdhocByPeriod(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorName).toBe("ACME Events");
    expect(rows[0].version).toBe(0);
  });

  it("updates a row when id is given and version matches; bumps version", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });
    const { rows } = await upsertAdhocBatch([{
      id: null, periodId: period.id, region: "N", state: "UP", district: null, taluka: null,
      activity: "X", activityDate: "2026-05-10", budgetHeader: "BTL",
      expenseAmount: "100.00", vendorName: "A", remarks: null, version: 0,
    }]).then(async (res) => ({ ...res, rows: await listAdhocByPeriod(period.id) }));

    const orig = rows[0];
    const updated = await upsertAdhocBatch([{ ...orig, expenseAmount: "200.00" }]);
    expect(updated.updated).toBe(1);
    expect(updated.conflicts).toEqual([]);

    const fresh = (await listAdhocByPeriod(period.id))[0];
    expect(fresh.expenseAmount).toBe("200.00");
    expect(fresh.version).toBe(1);
  });

  it("collects version conflicts instead of throwing", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });
    await upsertAdhocBatch([{
      id: null, periodId: period.id, region: null, state: null, district: null, taluka: null,
      activity: "X", activityDate: "2026-05-10", budgetHeader: null,
      expenseAmount: "100.00", vendorName: null, remarks: null, version: 0,
    }]);
    const orig = (await listAdhocByPeriod(period.id))[0];

    // Pretend client sent stale version.
    const stale = { ...orig, expenseAmount: "999.00", version: 0 };
    const res = await upsertAdhocBatch([stale]);
    expect(res.updated).toBe(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].id).toBe(orig.id);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run lib/db/adhoc.test.ts`
Expected: FAIL — `Cannot find module './adhoc'`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/adhoc.test.ts
git commit -m "test(adhoc-dal): RED — listAdhocByPeriod, upsertAdhocBatch, version conflicts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.4: Implement the adhoc DAL

**Files:**
- Create: `lib/db/adhoc.ts`

- [ ] **Step 1: Write the DAL**

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { adhocExpenses } from "./schema";

export type AdhocRow = {
  id: number;
  periodId: number;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  activity: string | null;
  activityDate: string | null;
  budgetHeader: string | null;
  expenseAmount: string | null; // numeric → text (D-05 / Pitfall 8)
  vendorName: string | null;
  remarks: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AdhocInput = {
  id: number | null;          // null = insert, number = update
  periodId: number;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  activity: string | null;
  activityDate: string | null;
  budgetHeader: string | null;
  expenseAmount: string | null;
  vendorName: string | null;
  remarks: string | null;
  version: number;
};

export type AdhocBatchResult = {
  inserted: number;
  updated: number;
  conflicts: { id: number; serverVersion: number }[];
};

/**
 * List every adhoc expense row in a period, ordered by activityDate desc, id desc.
 */
export async function listAdhocByPeriod(periodId: number): Promise<AdhocRow[]> {
  const rows = await db
    .select()
    .from(adhocExpenses)
    .where(eq(adhocExpenses.periodId, periodId))
    .orderBy(sql`${adhocExpenses.activityDate} desc nulls last, ${adhocExpenses.id} desc`);

  return rows.map((r) => ({
    id: r.id,
    periodId: r.periodId,
    region: r.region,
    state: r.state,
    district: r.district,
    taluka: r.taluka,
    activity: r.activity,
    activityDate: r.activityDate,
    budgetHeader: r.budgetHeader,
    expenseAmount: r.expenseAmount,
    vendorName: r.vendorName,
    remarks: r.remarks,
    version: r.version,
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
  }));
}

/**
 * Upsert a batch of adhoc rows in a single transaction.
 *
 * - rows with id === null are INSERTED with version=0.
 * - rows with id !== null are UPDATED with WHERE id=? AND version=?, RETURNING.
 *   If the WHERE matches 0 rows (stale version), the row is added to `conflicts`
 *   and the transaction CONTINUES — mirrors saveExecutionsBatch's
 *   collect-don't-throw semantics for partial-success batches.
 */
export async function upsertAdhocBatch(
  inputs: AdhocInput[],
): Promise<AdhocBatchResult> {
  const result: AdhocBatchResult = { inserted: 0, updated: 0, conflicts: [] };

  await db.transaction(async (tx) => {
    for (const input of inputs) {
      if (input.id == null) {
        await tx.insert(adhocExpenses).values({
          periodId: input.periodId,
          region: input.region,
          state: input.state,
          district: input.district,
          taluka: input.taluka,
          activity: input.activity,
          activityDate: input.activityDate,
          budgetHeader: input.budgetHeader,
          expenseAmount: input.expenseAmount,
          vendorName: input.vendorName,
          remarks: input.remarks,
          version: 0,
        });
        result.inserted += 1;
      } else {
        const updated = await tx
          .update(adhocExpenses)
          .set({
            region: input.region,
            state: input.state,
            district: input.district,
            taluka: input.taluka,
            activity: input.activity,
            activityDate: input.activityDate,
            budgetHeader: input.budgetHeader,
            expenseAmount: input.expenseAmount,
            vendorName: input.vendorName,
            remarks: input.remarks,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(adhocExpenses.id, input.id),
              eq(adhocExpenses.version, input.version),
            ),
          )
          .returning({ id: adhocExpenses.id, version: adhocExpenses.version });

        if (updated.length === 0) {
          // Read the current version for the conflict report.
          const [current] = await tx
            .select({ version: adhocExpenses.version })
            .from(adhocExpenses)
            .where(eq(adhocExpenses.id, input.id));
          result.conflicts.push({
            id: input.id,
            serverVersion: current?.version ?? -1,
          });
        } else {
          result.updated += 1;
        }
      }
    }
  });

  return result;
}

/** Test helper — wipes the table. Vitest beforeEach uses this. */
export async function _resetAdhocForTest(): Promise<void> {
  await db.delete(adhocExpenses);
}
```

- [ ] **Step 2: Run DAL tests**

Run: `npx vitest run lib/db/adhoc.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/db/adhoc.ts
git commit -m "feat(adhoc-dal): listAdhocByPeriod + upsertAdhocBatch + reset helper

GREEN — partial-success semantics on version conflicts mirrors
saveExecutionsBatch (D3-11).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.5: Write failing test for saveAdhocExpenses Server Action

**Files:**
- Create: `lib/actions/adhoc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureMigrated } from "@/lib/db/migrate";
import { _resetPeriodsForTest, insertPeriod } from "@/lib/db/periods";
import { _resetAdhocForTest, listAdhocByPeriod } from "@/lib/db/adhoc";

// Mock the session — pattern copied from lib/actions/executions.test.ts.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "fake-token" }) }),
}));
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "session",
  verifySession: async () => true,
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { saveAdhocExpenses } from "./adhoc";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetAdhocForTest();
  await _resetPeriodsForTest();
});

describe("saveAdhocExpenses", () => {
  it("rejects when periodId is missing", async () => {
    await expect(
      saveAdhocExpenses({ periodId: 0 as unknown as number, rows: [] }),
    ).rejects.toThrow(/periodId/i);
  });

  it("inserts new rows and returns the batch result", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });
    const result = await saveAdhocExpenses({
      periodId: period.id,
      rows: [{
        id: null, region: "N", state: "UP", district: "Agra", taluka: null,
        activity: "Local event", activityDate: "2026-05-10",
        budgetHeader: "BTL", expenseAmount: 12500, vendorName: "ACME", remarks: null,
        version: 0,
      }],
    });
    expect(result.inserted).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(await listAdhocByPeriod(period.id)).toHaveLength(1);
  });

  it("rejects negative expense amounts", async () => {
    const period = await insertPeriod({ type: "quarter", label: "Q1", startDate: "2026-04-01", endDate: "2026-06-30", isActive: true });
    await expect(
      saveAdhocExpenses({
        periodId: period.id,
        rows: [{
          id: null, region: null, state: null, district: null, taluka: null,
          activity: "X", activityDate: "2026-05-10",
          budgetHeader: null, expenseAmount: -5, vendorName: null, remarks: null,
          version: 0,
        }],
      }),
    ).rejects.toThrow(/expense/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run lib/actions/adhoc.test.ts`
Expected: FAIL — `Cannot find module './adhoc'`.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/adhoc.test.ts
git commit -m "test(adhoc-action): RED — saveAdhocExpenses auth, validation, insert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.6: Implement saveAdhocExpenses Server Action

**Files:**
- Create: `lib/actions/adhoc.ts`

- [ ] **Step 1: Write the action**

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { upsertAdhocBatch, type AdhocBatchResult } from "@/lib/db/adhoc";

async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    throw new Error("Unauthorized");
  }
}

const adhocRowSchema = z.object({
  id: z.number().int().positive().nullable(),
  region: z.string().nullable(),
  state: z.string().nullable(),
  district: z.string().nullable(),
  taluka: z.string().nullable(),
  activity: z.string().nullable(),
  activityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "activityDate must be ISO YYYY-MM-DD")
    .nullable(),
  budgetHeader: z.string().nullable(),
  expenseAmount: z
    .number()
    .finite()
    .nonnegative("expense amount must be non-negative")
    .nullable(),
  vendorName: z.string().nullable(),
  remarks: z.string().nullable(),
  version: z.number().int().min(0),
});

const payloadSchema = z.object({
  periodId: z.number().int().positive("periodId is required"),
  rows: z.array(adhocRowSchema).max(2000),
});

export type SaveAdhocPayload = z.infer<typeof payloadSchema>;

export async function saveAdhocExpenses(
  payload: SaveAdhocPayload,
): Promise<AdhocBatchResult> {
  await requireSession();
  const parsed = payloadSchema.parse(payload);

  const result = await upsertAdhocBatch(
    parsed.rows.map((r) => ({
      ...r,
      periodId: parsed.periodId,
      expenseAmount: r.expenseAmount == null ? null : r.expenseAmount.toFixed(2),
    })),
  );

  revalidatePath("/actuals");
  return result;
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run lib/actions/adhoc.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 3: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/adhoc.ts
git commit -m "feat(adhoc-action): saveAdhocExpenses Server Action

GREEN — requireSession first (CVE-2025-29927 discipline), Zod-validated,
numeric expenseAmount → fixed-2 string for numeric(14,2), revalidate /actuals.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.7: Extend ActivitySwitcher to accept "adhoc"

**Files:**
- Modify: `app/(app)/actuals/activity-switcher.tsx`

- [ ] **Step 1: Broaden the type and inject the Adhoc tab**

Replace the component body in `activity-switcher.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { ACTIVITIES } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

export type ActualsTabKey = ActivityKey | "adhoc";

export default function ActivitySwitcher({
  activityKeys,
  activeKey,
}: {
  activityKeys: readonly ActivityKey[];
  activeKey: ActualsTabKey;
}) {
  const router = useRouter();

  function go(key: ActualsTabKey) {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    params.set("activity", key);
    router.push(`/actuals?${params.toString()}`);
  }

  // Build the labelled list in render order: registry activities + Adhoc Expenses.
  const tabs: { key: ActualsTabKey; label: string }[] = [
    ...activityKeys.map((k) => ({ key: k, label: ACTIVITIES[k].label })),
    { key: "adhoc", label: "Adhoc Expenses" },
  ];

  return (
    <div
      data-slot="activity-select"
      role="tablist"
      aria-label="Select activity"
      className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 whitespace-nowrap sm:mx-0 sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:px-0"
    >
      {tabs.map(({ key, label }) => {
        const isActive = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            data-activity={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => go(key)}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-3.5 text-sm font-medium ${
              isActive
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (page.tsx's `activeKey` is still `ActivityKey`, which is a subtype of `ActualsTabKey` — assignable.)

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/actuals/activity-switcher.tsx
git commit -m "feat(actuals): ActivitySwitcher renders Adhoc Expenses as 7th tab

ActualsTabKey = ActivityKey | 'adhoc'. Activity registry untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.8: Build the AdhocGrid component

**Files:**
- Create: `app/(app)/actuals/adhoc-grid.tsx`

- [ ] **Step 1: Write the AG Grid component**

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridReadyEvent } from "ag-grid-community";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import { saveAdhocExpenses } from "@/lib/actions/adhoc";
import { ACTIVITIES, ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { AdhocRow } from "@/lib/db/adhoc";

ModuleRegistry.registerModules([AllCommunityModule]);

type GridRow = Omit<AdhocRow, "createdAt" | "updatedAt" | "expenseAmount"> & {
  expenseAmount: number | null;
  _dirty?: boolean;
};

function toGridRow(r: AdhocRow): GridRow {
  return {
    id: r.id,
    periodId: r.periodId,
    region: r.region,
    state: r.state,
    district: r.district,
    taluka: r.taluka,
    activity: r.activity,
    activityDate: r.activityDate,
    budgetHeader: r.budgetHeader,
    expenseAmount: r.expenseAmount == null ? null : Number(r.expenseAmount),
    vendorName: r.vendorName,
    remarks: r.remarks,
    version: r.version,
  };
}

const ACTIVITY_LABEL_SUGGESTIONS = ACTIVITY_KEYS.map((k) => ACTIVITIES[k].label);

function monthOf(dateIso: string | null): string {
  if (!dateIso) return "";
  // Activity month is derived from activityDate — single source of truth (D3-adhoc).
  const d = new Date(dateIso + "T00:00:00Z");
  return d.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

export default function AdhocGrid({
  initialRows,
  periodId,
}: {
  initialRows: AdhocRow[];
  periodId: number;
}) {
  const gridRef = useRef<AgGridReact<GridRow>>(null);
  const [rowData, setRowData] = useState<GridRow[]>(() =>
    initialRows.map(toGridRow),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: "region", headerName: "Region", editable: true },
      { field: "state", headerName: "State", editable: true },
      { field: "district", headerName: "District", editable: true },
      { field: "taluka", headerName: "Taluka", editable: true },
      {
        field: "activity",
        headerName: "Activity",
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ACTIVITY_LABEL_SUGGESTIONS, comboboxEditingDisabled: false },
      },
      {
        field: "activityDate",
        headerName: "Date of activity",
        editable: true,
        valueParser: (p) => {
          const v = p.newValue;
          if (!v) return null;
          // Accept DD/MM/YY or DD/MM/YYYY input; normalize to ISO YYYY-MM-DD.
          const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
          if (m) {
            const dd = m[1].padStart(2, "0");
            const mm = m[2].padStart(2, "0");
            let yyyy = m[3];
            if (yyyy.length === 2) yyyy = `20${yyyy}`;
            return `${yyyy}-${mm}-${dd}`;
          }
          // Already ISO?
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
          return p.oldValue;
        },
      },
      {
        headerName: "Month of activity",
        editable: false,
        valueGetter: (p) => monthOf(p.data?.activityDate ?? null),
      },
      { field: "budgetHeader", headerName: "Budget header", editable: true },
      {
        field: "expenseAmount",
        headerName: "Expense (₹, ex-GST)",
        editable: true,
        valueParser: (p) => {
          const n = Number(p.newValue);
          return Number.isFinite(n) && n >= 0 ? n : p.oldValue;
        },
      },
      { field: "vendorName", headerName: "Vendor name", editable: true },
      { field: "remarks", headerName: "Remarks", editable: true },
    ],
    [],
  );

  const onCellValueChanged = useCallback((e: { data: GridRow }) => {
    e.data._dirty = true;
  }, []);

  function addRow() {
    setRowData((rows) => [
      ...rows,
      {
        id: null as unknown as number, // null until saved
        periodId,
        region: null, state: null, district: null, taluka: null,
        activity: null, activityDate: null, budgetHeader: null,
        expenseAmount: null, vendorName: null, remarks: null, version: 0,
        _dirty: true,
      },
    ]);
  }

  async function save() {
    const grid = gridRef.current;
    if (!grid) return;
    setSaving(true);
    setStatus("Saving…");

    const dirty: GridRow[] = [];
    grid.api.forEachNode((node) => {
      if (node.data?._dirty) dirty.push(node.data);
    });

    try {
      const res = await saveAdhocExpenses({
        periodId,
        rows: dirty.map((r) => ({
          id: r.id ?? null,
          region: r.region, state: r.state, district: r.district, taluka: r.taluka,
          activity: r.activity, activityDate: r.activityDate,
          budgetHeader: r.budgetHeader, expenseAmount: r.expenseAmount,
          vendorName: r.vendorName, remarks: r.remarks, version: r.version,
        })),
      });
      setStatus(
        `Saved ${res.inserted + res.updated} row(s).${
          res.conflicts.length ? ` ${res.conflicts.length} conflict(s) — reload.` : ""
        }`,
      );
      // After save, reload via router to pick up canonical server state.
      window.location.reload();
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const onGridReady = useCallback((_e: GridReadyEvent) => {
    /* future: focus or auto-size */
  }, []);

  return (
    <div data-slot="adhoc-grid" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-10 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50"
        >
          + Add row
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500" aria-live="polite">{status}</span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="ag-theme-quartz" style={{ height: 480, width: "100%" }}>
        <AgGridReact<GridRow>
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          onCellValueChanged={onCellValueChanged}
          onGridReady={onGridReady}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/actuals/adhoc-grid.tsx
git commit -m "feat(adhoc): editable AG Grid for adhoc expenses + Add row + Save

Activity column suggests registry labels but accepts free text.
activityDate parses DD/MM/YY → ISO; month is derived in a read-only column.
Calls saveAdhocExpenses Server Action; reloads on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.9: Branch /actuals page on adhoc tab

**Files:**
- Modify: `app/(app)/actuals/page.tsx`

- [ ] **Step 1: Add an early-return branch for `?activity=adhoc`**

In `app/(app)/actuals/page.tsx`, after the period-empty-state check but before the activity-key resolution (around line 73):

```tsx
// 1. Import at the top
import AdhocGrid from "./adhoc-grid";
import { listAdhocByPeriod } from "@/lib/db/adhoc";
import type { ActualsTabKey } from "./activity-switcher";

// 2. Replace the activity-key resolution block:
const rawActivity = resolvedParams.activity;
const activityParam = Array.isArray(rawActivity) ? rawActivity[0] : rawActivity;

// 2a. NEW BRANCH — adhoc tab
if (activityParam === "adhoc") {
  const adhocRows = await listAdhocByPeriod(activePeriod.id);
  return (
    <div data-slot="actuals-page" className="mx-auto max-w-[1600px]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Actuals</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Adhoc expenses recorded for{" "}
            <span className="font-medium">{activePeriod.label}</span>.
          </p>
        </div>
      </header>
      <ActivitySwitcher activityKeys={ACTIVITY_KEYS} activeKey={"adhoc" as ActualsTabKey} />
      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 p-4">
          <h2 className="text-base font-semibold">Adhoc Expenses</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Off-plan, period-scoped spend. Not gated by SFID.
          </p>
        </div>
        <div className="p-4">
          <AdhocGrid initialRows={adhocRows} periodId={activePeriod.id} />
        </div>
      </section>
    </div>
  );
}

// 2b. Existing activity resolution path stays below — unchanged.
const activityKey: ActivityKey =
  activityParam && ACTIVITY_KEYS.includes(activityParam as ActivityKey)
    ? (activityParam as ActivityKey)
    : ACTIVITY_KEYS[0];
```

- [ ] **Step 2: TypeCheck + unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; tests green.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/actuals/page.tsx
git commit -m "feat(actuals): /actuals?activity=adhoc renders AdhocGrid

Early-return branch keeps the existing activity-key path untouched.
Reuses ActivitySwitcher (now ActualsTabKey-typed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.10: Playwright e2e for the adhoc tab

**Files:**
- Create: `e2e/adhoc-expenses.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

test.describe("adhoc expenses tab", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("tab appears, add row, save persists, month is derived", async ({ page }) => {
    await page.goto("/actuals");
    await page.locator('[role="tab"][data-activity="adhoc"]').click();
    await expect(page.locator('[data-slot="adhoc-grid"]')).toBeVisible();

    await page.getByRole("button", { name: "+ Add row" }).click();

    // Fill the first editable cells in the new row. AG Grid's reliable e2e path is to
    // double-click each cell to enter edit mode then type+blur.
    async function setCell(colHeader: string, value: string) {
      const cell = page.locator(`[col-id="${colHeader}"]`).last();
      await cell.dblclick();
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
    }
    await setCell("region", "North");
    await setCell("state", "UP");
    await setCell("district", "Agra");
    await setCell("activity", "Local event");
    await setCell("activityDate", "10/05/26");
    await setCell("budgetHeader", "BTL");
    await setCell("expenseAmount", "12500");
    await setCell("vendorName", "ACME");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-slot="adhoc-grid"]')).toBeVisible(); // reload completes

    // After reload: the saved row is present, "Month of activity" reads "May 2026".
    await expect(page.getByText("ACME")).toBeVisible();
    await expect(page.getByText("May 2026")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run e2e**

Run: `npx playwright test e2e/adhoc-expenses.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/adhoc-expenses.spec.ts
git commit -m "test(adhoc): e2e — switch tab, add row, save, month derived

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Deferred Enhancements (out of this plan's scope)

- **Excel export of adhoc rows.** The spec mentions a SheetJS server-side export per tab; the user's actual ask did not include it. Defer to a follow-up — add a button on the Adhoc tab that POSTs to a new Route Handler returning `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. ~30 min of work; not blocking the v1 of this feature.
- **Promoting `budgetHeader` to a configured dropdown.** Stays free text in v1. Promote once distinct values across periods stabilize into a usable taxonomy.
- **Adding `planSqft` to In-shop Branding's plan template.** Would require schema + plan-upload template + AG Grid plan column changes. Not in scope.

---

## Final Verification

### Task 4.1: Full test + typecheck + build

- [ ] **Step 1: TypeCheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: E2E**

Run: `npx playwright test`
Expected: all green.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: exit 0. Catches any RSC vs Client-Component boundary mistakes.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/dashboard-adhoc-filter-dropdowns
```

- [ ] **Step 6: Open PR**

(Manual or via `gh pr create` if available.) PR title: `feat: dashboard breakdown card, adhoc expenses tab, filter dropdowns`. Body should reference both the spec doc and this plan.
