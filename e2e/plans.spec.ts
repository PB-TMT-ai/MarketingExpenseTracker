import { test, expect, type Page } from "@playwright/test";

/**
 * E2E for Plan 02-03 — the user-facing surface for plan upload.
 *
 * Two tests:
 *   1. Happy path: login → /periods (create active period) → /plans/upload →
 *      pick activity + period → upload fixture → preview shows 2 valid rows →
 *      commit → success block → /plans cell shows "2 rows".
 *   2. Blocked-by-actuals (closes COMP-02 user-facing surface): same setup,
 *      then seed an execution against SF-A via the gated /api/test/seed-execution
 *      Route Handler, re-upload with only SF-B → blocked-dealers list shows
 *      SF-A → /plans still shows 2 rows (rollback held — no destructive write).
 *
 * Each test logs in fresh and uses Date.now() in labels so re-runs are independent.
 * The Playwright config wipes .pglite/ before booting next dev so the DB is clean.
 */

const DEV_PASSWORD = "jsw-marketing-2026";

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", DEV_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("/", { timeout: 10_000 });
}

/**
 * Create a period via the periods page UI and make it active. Returns the label so
 * the calling test can locate the same period later (the periods table sorts by
 * createdAt DESC, so the most recently created period is always the first row).
 */
async function createActivePeriod(page: Page): Promise<string> {
  const label = `Plans E2E ${Date.now()}`;
  await page.goto("/periods");
  await page.selectOption("select[name=type]", "month");
  await page.fill("input[name=label]", label);
  await page.fill("input[name=startDate]", "2026-08-01");
  await page.fill("input[name=endDate]", "2026-08-31");
  await page.check("input[name=makeActive]");
  await page.click("button[type=submit]:has-text('Create period')");
  // Wait for the row + active marker before continuing.
  const row = page.locator("li", { hasText: label });
  await expect(row).toBeVisible();
  await expect(row.getByText("active", { exact: true })).toBeVisible();
  return label;
}

test("happy path: upload → preview → commit → list shows rows", async ({
  page,
}) => {
  await login(page);
  const periodLabel = await createActivePeriod(page);

  // Land on the upload page. The Server Component reads getActivePeriod so the
  // period selector should default to the active one we just created.
  await page.goto("/plans/upload");

  // Pick activity. (Defaults to counter-wall when no ?activity in URL.)
  await page.selectOption(
    'select[data-slot="activity-select"]',
    "counter-wall",
  );

  // Confirm the period selector defaults to the active period (D-11).
  const periodSelect = page.locator('select[data-slot="period-select"]');
  await expect(periodSelect.locator("option:checked")).toContainText(periodLabel);
  await expect(periodSelect.locator("option:checked")).toContainText("(active)");

  // Upload the 2-row fixture.
  await page.setInputFiles(
    'input[data-slot="file-input"]',
    "e2e/fixtures/plan-counter-wall.xlsx",
  );

  // Preview renders with exactly 2 rows, both classified "valid".
  const previewRows = page.locator('[data-slot="preview-row"]');
  await expect(previewRows).toHaveCount(2);
  await expect(
    page.locator('[data-slot="preview-row"][data-classification="valid"]'),
  ).toHaveCount(2);

  // Commit.
  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");

  // Success block visible and reports 2 inserted.
  const success = page.locator('[data-slot="commit-success"]');
  await expect(success).toBeVisible();
  await expect(success).toContainText("2");
  await expect(success).toContainText("inserted");

  // /plans cell shows "2 rows" for (counter-wall, our period).
  await page.goto("/plans");
  const cell = page.locator(
    '[data-slot="plan-cell"][data-activity="counter-wall"]',
    { hasText: periodLabel },
  );
  await expect(cell).toBeVisible();
  await expect(cell).toContainText("2");
  await expect(cell).toContainText("rows");
});

test("blocked-by-actuals: re-uploading omits a SFID with executions → list shown, rollback holds (COMP-02)", async ({
  page,
  request,
}) => {
  await login(page);
  const periodLabel = await createActivePeriod(page);

  // (1) Upload + commit the 2-row plan first (same as the happy path).
  await page.goto("/plans/upload");
  await page.selectOption(
    'select[data-slot="activity-select"]',
    "counter-wall",
  );
  await page.setInputFiles(
    'input[data-slot="file-input"]',
    "e2e/fixtures/plan-counter-wall.xlsx",
  );
  await expect(page.locator('[data-slot="preview-row"]')).toHaveCount(2);
  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="commit-success"]')).toBeVisible();

  // (2) Read the periodId from the period-select option value (the form's hidden
  // input mirrors it; both have the same source). We pick the option value so the
  // test doesn't depend on form internals.
  const periodId = await page
    .locator('select[data-slot="period-select"] option:checked')
    .getAttribute("value");
  expect(periodId).toBeTruthy();

  // (3) Seed an execution against SF-A via the gated test-only Route Handler.
  // The Playwright APIRequestContext (`request`) preserves the cookie jar from the
  // page context as long as we use page.request — fall back to copy the cookies
  // manually for the bare `request` fixture.
  const cookies = await page.context().cookies();
  const cookieHeader = cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const seedResp = await request.post("/api/test/seed-execution", {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: {
      periodId: Number(periodId),
      activity: "counter-wall",
      sfid: "SF-A",
    },
  });
  expect(seedResp.status(), `seed-execution response: ${await seedResp.text()}`).toBe(200);

  // (4) Re-upload the "only B" fixture (drops SF-A). The commit must be rejected.
  await page.goto("/plans/upload");
  await page.selectOption(
    'select[data-slot="activity-select"]',
    "counter-wall",
  );
  // The period selector should still default to the active period — same one.
  await page.setInputFiles(
    'input[data-slot="file-input"]',
    "e2e/fixtures/plan-counter-wall-only-b.xlsx",
  );
  // SF-B already exists in DB → preview should classify it as "update".
  await expect(page.locator('[data-slot="preview-row"]')).toHaveCount(1);

  await page.click('[data-slot="commit-button"]');
  await page.waitForLoadState("networkidle");

  // (5) Blocked-dealers list is visible and lists SF-A.
  const blocked = page.locator('[data-slot="blocked-dealers"]');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("SF-A");
  await expect(blocked).toContainText("execution");
  // No success block.
  await expect(page.locator('[data-slot="commit-success"]')).toHaveCount(0);

  // (6) /plans still shows "2 rows" for (counter-wall, periodLabel) — the
  // transaction rolled back: no destructive write occurred (D2-01 user-facing).
  await page.goto("/plans");
  const cell = page.locator(
    '[data-slot="plan-cell"][data-activity="counter-wall"]',
    { hasText: periodLabel },
  );
  await expect(cell).toBeVisible();
  await expect(cell).toContainText("2");
  await expect(cell).toContainText("rows");
});
