import { test, expect, type Page } from "@playwright/test";

/**
 * E2E for the MultiSelectPopover filter on /actuals (Task 1.5 — dashboard-adhoc-filter-dropdowns).
 *
 * The popover replaced the always-expanded <select multiple> per-facet listbox. We assert
 * the end-to-end user flow on a real seeded actuals page:
 *   - open the Region popover from a trigger button
 *   - search narrows the list
 *   - toggling a checkbox fires the parent onChange → trigger button shows the count badge
 *   - clicking outside the popover closes it
 *
 * Seeding mirrors e2e/dashboard.spec.ts: uploadGeoPlan() ships the multi-region
 * counter-wall fixture (16 rows: North/South × StateA/StateB × …), which guarantees the
 * Region facet has real options ("North", "South") when the actuals page loads.
 *
 * Convention: inline login() / createActivePeriod() / upload helpers (per the existing
 * spec pattern — no shared e2e/helpers/ module in this codebase yet).
 *
 * Selectors used (see app/(app)/multi-select-popover.tsx):
 *   [data-slot="filter-region"]        — wrapper around the Region trigger + popover
 *   button (first inside that wrapper) — the open/close trigger; shows "(n)" count badge
 *   role=listbox                       — the popover panel
 *   placeholder="Search…"              — the in-popover search input
 *   role=checkbox name="<option>"      — the option checkboxes
 */

const DEV_PASSWORD = "jsw-marketing-2026";

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", DEV_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("/", { timeout: 10_000 });
}

async function createActivePeriod(page: Page): Promise<void> {
  const label = `Filter Popover E2E ${Date.now()}`;
  await page.goto("/periods");
  await page.selectOption("select[name=type]", "month");
  await page.fill("input[name=label]", label);
  await page.fill("input[name=startDate]", "2026-09-01");
  await page.fill("input[name=endDate]", "2026-09-30");
  await page.check("input[name=makeActive]");
  await page.click("button[type=submit]:has-text('Create period')");
  const row = page.locator("li", { hasText: label });
  await expect(row).toBeVisible();
  await expect(row.getByText("active", { exact: true })).toBeVisible();
}

/**
 * Upload + commit the multi-geo counter-wall plan (16 rows: 2 regions × 2 states ×
 * 2 districts × 2 talukas). Two regions (North + South) are what we filter on.
 */
async function uploadGeoPlan(page: Page): Promise<void> {
  await page.goto("/plans/upload");
  await page.selectOption('select[data-slot="activity-select"]', "counter-wall");
  await page.setInputFiles(
    'input[data-slot="file-input"]',
    "e2e/fixtures/plan-counter-wall-geo.xlsx",
  );
  await expect(page.locator('[data-slot="preview-row"]')).toHaveCount(16);
  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="commit-success"]')).toBeVisible();
}

/** Wait for the AG Grid to render at least one data row — same pattern as actuals.spec.ts. */
async function waitForGrid(page: Page) {
  await expect(page.locator(".ag-root-wrapper")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 10_000 });
}

test.describe("filter popover", () => {
  test("opens, filters by search, toggles a value, and shows count badge", async ({
    page,
  }) => {
    await login(page);
    await createActivePeriod(page);
    await uploadGeoPlan(page);

    await page.goto("/actuals?activity=counter-wall");
    await page.waitForLoadState("networkidle");
    await waitForGrid(page);

    // The Region popover lives inside [data-slot="filter-region"]. The trigger is the
    // first <button> in that wrapper (the popover panel renders Select all / Clear
    // buttons too, so we anchor on .first() to get the trigger).
    const regionWrap = page.locator('[data-slot="filter-region"]');
    await expect(regionWrap).toBeVisible();
    const regionTrigger = regionWrap.locator("button").first();

    // Before opening: no count badge — selection is empty.
    await expect(regionTrigger).not.toContainText("(");

    // Open the popover.
    await regionTrigger.click();

    // The popover panel (role=listbox) is now visible with a search input.
    const panel = regionWrap.locator('[role="listbox"]');
    await expect(panel).toBeVisible();
    const search = panel.getByPlaceholder("Search…");
    await expect(search).toBeVisible();

    // Both regions are listed (the geo fixture seeds North + South).
    await expect(panel.getByRole("checkbox", { name: "North" })).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: "South" })).toBeVisible();

    // Search narrows the list — case-insensitive substring match.
    await search.fill("north");
    await expect(panel.getByRole("checkbox", { name: "North" })).toBeVisible();
    // "South" no longer matches the filter.
    await expect(panel.getByRole("checkbox", { name: "South" })).toHaveCount(0);

    // Toggle "North". The parent onChange fires, selected updates, the trigger button
    // shows the "(1)" count badge.
    await panel.getByRole("checkbox", { name: "North" }).check();
    await expect(regionTrigger).toContainText("(1)");

    // Outside click closes the popover. Click somewhere safe — the actuals page heading.
    // (The popover's outside-click listener is mousedown on document; clicking an h1 is
    // outside the wrapper ref so the panel hides.)
    await page.locator("h1").first().click();
    await expect(panel).toBeHidden();
  });
});
