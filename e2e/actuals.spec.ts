import { test, expect, type Page } from "@playwright/test";

/**
 * E2E for Plan 03-04 — the /actuals grid.
 *
 * Three tests:
 *   1. edit→Save→reload persists: upload plan → go to /actuals → edit a cell →
 *      Save bar shows unsaved count → click Save → saved confirmation → reload →
 *      value is still present.
 *   2. Derived auto-calc visible: enter actualSqft + perUnitCost on a counter-wall row →
 *      assert the derived totalCost cell shows the computed value before Save.
 *   3. Stale-version conflict holds (D3-11): seed an execution, then from a second browser
 *      context bump the server version, then Save from the first context (stale version) →
 *      "row-conflict" marker appears; conflict row's value is NOT overwritten.
 *
 * AG Grid interaction notes:
 *   - Column virtualization: AG Grid may not render off-screen columns. Use
 *     page.evaluate() with the AG Grid API to set values programmatically, or scroll
 *     to column first. For status (agSelectCellEditor) we can use the grid's column
 *     that is visible by default (Status is one of the first actual columns).
 *   - Cell editing: dblclick to start edit, keyboard input, Tab/Enter to confirm.
 *   - data-slot selectors on our custom UI elements (save-bar, filter-bar, etc.).
 *
 * Conventions mirror e2e/plans.spec.ts:
 *   - DEV_PASSWORD constant, login() and createActivePeriod() helpers.
 *   - data-slot selectors for our components; AG Grid standard class selectors for the grid.
 *   - Single worker (fullyParallel: false in playwright.config.ts).
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
  const label = `Actuals E2E ${Date.now()}`;
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
  return label;
}

async function uploadCounterWallPlan(page: Page): Promise<string> {
  await page.goto("/plans/upload");
  await page.selectOption('select[data-slot="activity-select"]', "counter-wall");
  await page.setInputFiles(
    'input[data-slot="file-input"]',
    "e2e/fixtures/plan-counter-wall.xlsx",
  );
  await expect(page.locator('[data-slot="preview-row"]')).toHaveCount(2);
  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="commit-success"]')).toBeVisible();

  const periodId = await page
    .locator('select[data-slot="period-select"] option:checked')
    .getAttribute("value");
  expect(periodId).toBeTruthy();
  return periodId as string;
}

/** Wait for the AG Grid to render at least one data row. */
async function waitForGrid(page: Page) {
  await expect(page.locator(".ag-root-wrapper")).toBeVisible({ timeout: 15_000 });
  // Wait for at least one ag-row to appear (data rows, not the loading placeholder).
  await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Ensure a column is scrolled into view using the AG Grid API (handles column virtualization).
 * The dev build exposes window.__actualsGridApi from actuals-grid.tsx.
 */
async function ensureColumnVisible(page: Page, colId: string) {
  await page.evaluate((id) => {
    const api = (window as unknown as Record<string, { ensureColumnVisible?: (c: string) => void }>).__actualsGridApi;
    if (api?.ensureColumnVisible) {
      api.ensureColumnVisible(id);
    }
  }, colId);
  // Small wait for AG Grid to render the column after scroll.
  await page.waitForTimeout(200);
}

/**
 * Edit a cell in the AG Grid by scrolling to column then double-clicking.
 * colId is the AG Grid col-id attribute (e.g. "fields.actualSqft", "plan.sfid").
 * rowIndex is 0-based (first data row = 0).
 */
async function editCell(page: Page, rowIndex: number, colId: string, value: string) {
  // Ensure the column is in the DOM (AG Grid column virtualization may omit off-screen cols).
  await ensureColumnVisible(page, colId);
  const cell = page
    .locator(`.ag-row[row-index="${rowIndex}"] [col-id="${colId}"]`)
    .first();
  await cell.scrollIntoViewIfNeeded();
  await cell.dblclick();
  // Clear any existing content and type the new value.
  await page.keyboard.press("Control+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Tab");
}

/** Get the displayed text of a cell (first row at rowIndex, given colId). */
async function getCellText(page: Page, rowIndex: number, colId: string): Promise<string> {
  await ensureColumnVisible(page, colId);
  const cell = page
    .locator(`.ag-row[row-index="${rowIndex}"] [col-id="${colId}"]`)
    .first();
  await cell.scrollIntoViewIfNeeded();
  return (await cell.textContent()) ?? "";
}

// ---------------------------------------------------------------------------
// Test 1: edit → Save → reload persists
// ---------------------------------------------------------------------------

test("edit → Save → reload: persisted value survives a full page reload", async ({
  page,
}) => {
  await login(page);
  await createActivePeriod(page);
  await uploadCounterWallPlan(page);

  await page.goto("/actuals?activity=counter-wall");
  await page.waitForLoadState("networkidle");

  // Page structure checks.
  await expect(page.locator('[data-slot="actuals-page"]')).toBeVisible();
  await expect(page.locator('[data-slot="actuals-grid"]')).toBeVisible();

  await waitForGrid(page);

  // Edit a plain text field (wallShopNo) to make the row dirty and test persistence.
  // This column may be off-screen; editCell handles column virtualization.
  await editCell(page, 0, "fields.wallShopNo", "WALL-001");

  // Save bar should appear showing at least 1 unsaved change.
  const saveBar = page.locator('[data-slot="save-bar"]');
  await expect(saveBar).toBeVisible({ timeout: 8_000 });
  const unsavedCount = page.locator('[data-slot="unsaved-count"]');
  await expect(unsavedCount).toBeVisible();

  // Click Save.
  const saveButton = page.locator('[data-slot="save-button"]');
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  // Wait for save confirmation.
  await expect(page.locator('[data-slot="save-confirmation"]')).toBeVisible({
    timeout: 15_000,
  });

  // Reload and verify the value persisted.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);

  // The saved wallShopNo should be visible in the grid.
  const savedText = await getCellText(page, 0, "fields.wallShopNo");
  expect(savedText.trim()).toContain("WALL-001");
});

// ---------------------------------------------------------------------------
// Test 2: derived auto-calc visible before Save
// ---------------------------------------------------------------------------

test("derived totalCost auto-computes from actualSqft × perUnitCost before Save", async ({
  page,
}) => {
  await login(page);
  await createActivePeriod(page);
  await uploadCounterWallPlan(page);

  await page.goto("/actuals?activity=counter-wall");
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);

  // Edit actualSqft on row 0.
  await editCell(page, 0, "fields.actualSqft", "100");
  // Edit perUnitCost on row 0.
  await editCell(page, 0, "fields.perUnitCost", "50");

  // After editing perUnitCost, Tab moves focus to the next cell (totalCost, which is derived).
  // Press Escape to close any open editor on totalCost so we can read its rendered value.
  await page.keyboard.press("Escape");
  // Click somewhere neutral to deselect and flush AG Grid rendering.
  await page.locator('[data-slot="actuals-grid"]').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  // totalCost = actualSqft × perUnitCost = 100 × 50 = 5000.
  // Ensure column is visible and read the cell's rendered text.
  await ensureColumnVisible(page, "totalCost");
  const totalCostCell = page.locator('.ag-row[row-index="0"] [col-id="totalCost"]').first();
  await totalCostCell.scrollIntoViewIfNeeded();
  await expect(totalCostCell).toContainText("5000", { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Test 3: stale-version conflict holds (D3-11)
// ---------------------------------------------------------------------------

test("stale-version Save surfaces row-conflict without clobbering; sibling unit saves", async ({
  page,
  request,
}) => {
  await login(page);
  await createActivePeriod(page);
  const periodId = await uploadCounterWallPlan(page);

  // Seed an execution for SF-A via the gated seed route.
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const seedResp = await request.post("/api/test/seed-execution", {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: { periodId: Number(periodId), activity: "counter-wall", sfid: "SF-A" },
  });
  expect(
    seedResp.status(),
    `seed-execution response: ${await seedResp.text()}`,
  ).toBe(200);
  const seedData = (await seedResp.json()) as {
    planRowId: number;
    executionId: number;
    version: number;
  };
  expect(seedData.executionId).toBeGreaterThan(0);

  // Step 1: Load /actuals in page1. SF-A has executionId=N, version=0.
  await page.goto("/actuals?activity=counter-wall");
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);

  // Edit SF-A's wallShopNo field on row 0.
  await editCell(page, 0, "fields.wallShopNo", "FIRST-SAVE");

  // Save — this is a clean save (version 0 → server bumps to 1).
  const saveButton = page.locator('[data-slot="save-button"]');
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();
  await expect(page.locator('[data-slot="save-confirmation"]')).toBeVisible({
    timeout: 15_000,
  });
  // After this: server has SF-A at version=1; grid has SF-A at version=1.

  // Step 2: From a second browser context, load /actuals, edit SF-A, and save.
  // This bumps server SF-A to version=2 without page1 knowing.
  const browser = page.context().browser()!;
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.context().clearCookies();
  await page2.goto("http://localhost:3000/login");
  await page2.fill("input[name=password]", DEV_PASSWORD);
  await page2.click("button[type=submit]");
  await page2.waitForURL("http://localhost:3000/", { timeout: 10_000 });

  await page2.goto("http://localhost:3000/actuals?activity=counter-wall");
  await page2.waitForLoadState("networkidle");
  await expect(page2.locator(".ag-root-wrapper")).toBeVisible({ timeout: 15_000 });
  await expect(page2.locator(".ag-row").first()).toBeVisible({ timeout: 10_000 });

  // Edit SF-A (row 0) in page2.
  const sfACell2 = page2
    .locator('.ag-row[row-index="0"] [col-id="fields.wallShopNo"]')
    .first();
  await sfACell2.scrollIntoViewIfNeeded();
  await sfACell2.dblclick();
  await page2.keyboard.press("Control+a");
  await page2.keyboard.type("PAGE2-SAVE");
  await page2.keyboard.press("Tab");

  // Save in page2 → version 1→2 on the server.
  await page2.locator('[data-slot="save-button"]').click();
  await expect(page2.locator('[data-slot="save-confirmation"]')).toBeVisible({
    timeout: 15_000,
  });
  await context2.close();

  // Step 3: Back in page1 (still has SF-A at version=1 which is now stale — server is at 2).
  // Edit SF-A again in page1 — this will try to UPDATE with version=1.
  await editCell(page, 0, "fields.wallShopNo", "STALE-ATTEMPT");

  // Also edit SF-B (row 1) — sibling should save OK.
  await editCell(page, 1, "fields.wallShopNo", "SIBLING-OK");

  // Save — SF-A should conflict; SF-B should succeed.
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  // Conflict marker should appear (D3-11 — "reload this row" without clobbering).
  const conflictMarkers = page.locator('[data-slot="row-conflict"]');
  await expect(conflictMarkers).toHaveCount(1, { timeout: 15_000 });
  await expect(conflictMarkers.first()).toBeVisible();

  // Reload and verify: SF-A has page2's value (PAGE2-SAVE), NOT page1's stale (STALE-ATTEMPT).
  await page.reload();
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);

  const sfAFinal = await getCellText(page, 0, "fields.wallShopNo");
  // Server should have PAGE2-SAVE (page1's stale attempt was blocked).
  expect(sfAFinal.trim()).toContain("PAGE2-SAVE");

  // SF-B's sibling save should have persisted.
  const sfBFinal = await getCellText(page, 1, "fields.wallShopNo");
  expect(sfBFinal.trim()).toContain("SIBLING-OK");
});

// ---------------------------------------------------------------------------
// 03-05 helpers
// ---------------------------------------------------------------------------

/** Add an item to the item master via /items. Confirms success by form reset. */
async function addItem(page: Page, name: string) {
  await page.goto("/items");
  await page.fill("input[name=name]", name);
  await page.click("button[type=submit]:has-text('Add item')");
  // The form resets its name input on success (state.ok) — robust success signal.
  await expect(page.locator("input[name=name]")).toHaveValue("", { timeout: 8_000 });
}

/** Upload + commit a single-activity plan fixture; returns the committed periodId. */
async function uploadPlan(
  page: Page,
  activity: string,
  fixture: string,
  expectRows: number,
): Promise<string> {
  await page.goto("/plans/upload");
  await page.selectOption('select[data-slot="activity-select"]', activity);
  await page.setInputFiles('input[data-slot="file-input"]', fixture);
  await expect(page.locator('[data-slot="preview-row"]')).toHaveCount(expectRows);
  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="commit-success"]')).toBeVisible();
  const periodId = await page
    .locator('select[data-slot="period-select"] option:checked')
    .getAttribute("value");
  expect(periodId).toBeTruthy();
  return periodId as string;
}

/**
 * Set an inline cell value via the AG Grid API (robust vs agSelect/agDate editor popups).
 * setDataValue fires onCellValueChanged → marks the row dirty, exactly like a user edit.
 */
async function setCellViaApi(
  page: Page,
  rowIndex: number,
  colId: string,
  value: string | number,
) {
  await page.evaluate(
    ({ rowIndex, colId, value }) => {
      const api = (
        window as unknown as Record<
          string,
          {
            getDisplayedRowAtIndex?: (i: number) => {
              setDataValue?: (c: string, v: unknown) => void;
            } | null;
          }
        >
      ).__actualsGridApi;
      const node = api?.getDisplayedRowAtIndex?.(rowIndex);
      node?.setDataValue?.(colId, value);
    },
    { rowIndex, colId, value },
  );
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// Test 4: POP/Dealer-Kit multi-item modal (GRID-06)
// ---------------------------------------------------------------------------

test("POP kit: add 2 line items → live totals → subtotal rollup → persist", async ({
  page,
}) => {
  await login(page);
  await createActivePeriod(page);
  await addItem(page, "Poster");
  await addItem(page, "Banner");
  await uploadPlan(page, "pop-dealer-kit", "e2e/fixtures/plan-pop-dealer-kit.xlsx", 1);

  await page.goto("/actuals?activity=pop-dealer-kit");
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);

  // Open the kit modal for the POP dealer row.
  await page.locator('[data-slot="pop-edit"]').first().click();
  await expect(page.locator('[data-slot="pop-modal"]')).toBeVisible();

  const lines = page.locator('[data-slot="pop-line"]');

  // Line 0: Poster × 2 @ 100 = 200.00
  await lines.nth(0).locator('[data-slot="pop-line-item"]').selectOption("Poster");
  await lines.nth(0).locator('[data-slot="pop-line-qty"]').fill("2");
  await lines.nth(0).locator('[data-slot="pop-line-rate"]').fill("100");
  await expect(lines.nth(0).locator('[data-slot="pop-line-total"]')).toHaveText("200.00");

  // Line 1: Banner × 3 @ 50 = 150.00
  await page.locator('[data-slot="pop-add-line"]').click();
  await lines.nth(1).locator('[data-slot="pop-line-item"]').selectOption("Banner");
  await lines.nth(1).locator('[data-slot="pop-line-qty"]').fill("3");
  await lines.nth(1).locator('[data-slot="pop-line-rate"]').fill("50");
  await expect(lines.nth(1).locator('[data-slot="pop-line-total"]')).toHaveText("150.00");

  // Subtotal rollup = 350.00
  await expect(page.locator('[data-slot="pop-subtotal"]')).toHaveText("₹350.00");

  // Confirm → modal closes, kit cell shows the count + rolled total, row is dirty.
  await page.locator('[data-slot="pop-confirm"]').click();
  await expect(page.locator('[data-slot="pop-modal"]')).toHaveCount(0);
  const kitCell = page.locator('[data-slot="pop-edit"]').first();
  await expect(kitCell).toContainText("2 items");
  await expect(kitCell).toContainText("350");

  // Save → confirmation.
  await page.locator('[data-slot="save-button"]').click();
  await expect(page.locator('[data-slot="save-confirmation"]')).toBeVisible({
    timeout: 15_000,
  });

  // Reload → kit persisted as one execution + 2 execution_items (loaded via listKitLines).
  await page.reload();
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);
  const kitAfter = page.locator('[data-slot="pop-edit"]').first();
  await expect(kitAfter).toContainText("2 items");
  await expect(kitAfter).toContainText("350");
});

// ---------------------------------------------------------------------------
// Test 5: Dealer Certificate inline Status + Date + Cost (GRID-08)
// ---------------------------------------------------------------------------

test("Dealer Certificate: Status + Date + Cost persist inline (no popup)", async ({
  page,
}) => {
  await login(page);
  await createActivePeriod(page);
  await uploadPlan(
    page,
    "dealer-certificate",
    "e2e/fixtures/plan-dealer-certificate.xlsx",
    1,
  );

  await page.goto("/actuals?activity=dealer-certificate");
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);

  // No POP modal affordance for a status-type activity.
  await expect(page.locator('[data-slot="pop-edit"]')).toHaveCount(0);

  // Set Status (Done = Issued), Date, Cost inline via the grid API.
  await setCellViaApi(page, 0, "fields.status", "Done");
  await setCellViaApi(page, 0, "fields.issuanceDate", "2026-09-15");
  await setCellViaApi(page, 0, "fields.cost", 1500);

  // Save → confirmation.
  await expect(page.locator('[data-slot="save-button"]')).toBeEnabled({ timeout: 8_000 });
  await page.locator('[data-slot="save-button"]').click();
  await expect(page.locator('[data-slot="save-confirmation"]')).toBeVisible({
    timeout: 15_000,
  });

  // Reload → Status + Cost persisted on the row.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await waitForGrid(page);
  expect((await getCellText(page, 0, "fields.status")).trim()).toContain("Done");
  expect((await getCellText(page, 0, "fields.cost")).trim()).toContain("1500");
});
