import { test, expect, type Page } from "@playwright/test";

/**
 * E2E for the Adhoc Expenses tab on /actuals (Task 3.10).
 *
 * Adhoc is off-plan by design: a period is required, but NO plan upload and NO
 * executions seed are needed. The tab appears in ActivitySwitcher with
 * data-activity="adhoc". Clicking it routes to /actuals?activity=adhoc and
 * renders <AdhocGrid> inside [data-slot="adhoc-grid"].
 *
 * Locks in:
 *   - Adhoc tab visible in the activity switcher.
 *   - Clicking the tab navigates to the adhoc grid surface.
 *   - "+ Add row" appends a blank editable row.
 *   - Editing region/state/district/activity/activityDate/budgetHeader/
 *     expenseAmount/vendorName persists after Save (which reloads the page).
 *   - "Month of activity" is read-only and derived from activityDate
 *     ("10/05/26" → "May 2026" via en-IN month-short formatting).
 *
 * Seeding follows e2e/actuals.spec.ts inline login + createActivePeriod helpers.
 */

const DEV_PASSWORD = "jsw-marketing-2026";

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", DEV_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("/", { timeout: 10_000 });
}

async function createActivePeriod(page: Page): Promise<string> {
  const label = `Adhoc E2E ${Date.now()}`;
  await page.goto("/periods");
  await page.selectOption("select[name=type]", "month");
  await page.fill("input[name=label]", label);
  await page.fill("input[name=startDate]", "2026-05-01");
  await page.fill("input[name=endDate]", "2026-05-31");
  await page.check("input[name=makeActive]");
  await page.click("button[type=submit]:has-text('Create period')");
  const row = page.locator("li", { hasText: label });
  await expect(row).toBeVisible();
  await expect(row.getByText("active", { exact: true })).toBeVisible();
  return label;
}

test.describe("adhoc expenses tab", () => {
  test("appears in switcher, add row, save persists, month is derived", async ({
    page,
  }) => {
    await login(page);
    await createActivePeriod(page);

    // Adhoc lives on /actuals — start at the default page and switch to Adhoc.
    await page.goto("/actuals");
    await page.waitForLoadState("networkidle");

    // Switcher tab exists and clicks through.
    const adhocTab = page.locator('[role="tab"][data-activity="adhoc"]');
    await expect(adhocTab).toBeVisible({ timeout: 10_000 });
    await adhocTab.click();

    await page.waitForURL(/\/actuals\?.*activity=adhoc/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    const grid = page.locator('[data-slot="adhoc-grid"]');
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // AG Grid root rendered.
    await expect(page.locator(".ag-root-wrapper")).toBeVisible({ timeout: 15_000 });

    // Append a blank row.
    await page.locator('[data-slot="adhoc-add-row"]').click();
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 10_000 });

    /**
     * Edit a cell in the LAST row by col-id. Adhoc uses singleClickEdit and
     * stopEditingWhenCellsLoseFocus, so a single click opens the editor and
     * Tab commits.
     */
    async function setCell(colId: string, value: string) {
      const cells = page.locator(`.ag-row .ag-cell[col-id="${colId}"]`);
      const cell = cells.last();
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      // Some text editors take a click to open; doubleclick is safe-noop if already editing.
      await cell.dblclick();
      await page.keyboard.press("Control+a");
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
      // Tiny settle to let AG Grid commit and advance focus to the next cell.
      await page.waitForTimeout(75);
    }

    await setCell("region", "North");
    await setCell("state", "UP");
    await setCell("district", "Agra");
    // Activity uses an agSelectCellEditor — pick a valid registry label.
    await setCell("activity", "Counter Wall");
    await setCell("activityDate", "10/05/26");
    await setCell("budgetHeader", "BTL");
    await setCell("expenseAmount", "12500");
    await setCell("vendorName", "ACME");

    // Save — reloads on success.
    await page.locator('[data-slot="adhoc-save"]').click();

    // After window.location.reload(), wait for the grid to remount.
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-slot="adhoc-grid"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 10_000 });

    // Saved row visible by vendor name.
    await expect(page.getByText("ACME").first()).toBeVisible({ timeout: 10_000 });

    // "Month of activity" is the read-only derived column — "10/05/26" → May 2026.
    await expect(page.getByText("May 2026").first()).toBeVisible({ timeout: 10_000 });
  });
});
