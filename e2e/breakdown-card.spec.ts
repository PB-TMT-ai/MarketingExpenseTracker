import { test, expect, type Page } from "@playwright/test";

/**
 * E2E for Task 2.7 — the dashboard <BreakdownCard>.
 *
 * Locks in:
 *   - The card is mounted on /dashboard (data-slot="breakdown-card").
 *   - Four tabs render with role="tab" + data-tab in
 *     {state, distributor, activity, region}.
 *   - "state" is the default-active tab (aria-selected=true).
 *   - Clicking each of the other three tabs switches aria-selected.
 *   - The underlying <table>'s last <tbody> row is a totals row whose
 *     first cell contains "Total".
 *
 * Seeding mirrors e2e/dashboard.spec.ts exactly: login → createActivePeriod →
 * uploadGeoPlan (counter-wall, 16 rows). No executions are needed — the card
 * renders against the plan rows alone, so the totals row is meaningful.
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
  const label = `BreakdownCard E2E ${Date.now()}`;
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

/** Upload + commit the counter-wall geo plan fixture (16 rows). */
async function uploadGeoPlan(page: Page, expectRows: number): Promise<void> {
  await page.goto("/plans/upload");
  await page.selectOption('select[data-slot="activity-select"]', "counter-wall");
  await page.setInputFiles(
    'input[data-slot="file-input"]',
    "e2e/fixtures/plan-counter-wall-geo.xlsx",
  );
  await expect(page.locator('[data-slot="preview-row"]')).toHaveCount(expectRows);
  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="commit-success"]')).toBeVisible();
}

test.describe("BreakdownCard", () => {
  test("tabs render, switch, and show totals row", async ({ page }) => {
    await login(page);
    await createActivePeriod(page);
    await uploadGeoPlan(page, 16);

    await page.goto("/dashboard");
    const card = page.locator('[data-slot="breakdown-card"]');
    await expect(card).toBeVisible();

    // State tab is default-active.
    await expect(
      card.locator('[role="tab"][data-tab="state"]'),
    ).toHaveAttribute("aria-selected", "true");

    // Click Distributor.
    await card.locator('[role="tab"][data-tab="distributor"]').click();
    await expect(
      card.locator('[role="tab"][data-tab="distributor"]'),
    ).toHaveAttribute("aria-selected", "true");

    // Click Activity.
    await card.locator('[role="tab"][data-tab="activity"]').click();
    await expect(
      card.locator('[role="tab"][data-tab="activity"]'),
    ).toHaveAttribute("aria-selected", "true");

    // Click Region.
    await card.locator('[role="tab"][data-tab="region"]').click();
    await expect(
      card.locator('[role="tab"][data-tab="region"]'),
    ).toHaveAttribute("aria-selected", "true");

    // Totals row exists: last row of tbody, first cell "Total".
    const totalsRow = card.locator("tbody tr").last();
    await expect(totalsRow).toContainText(/Total/i);
  });
});
