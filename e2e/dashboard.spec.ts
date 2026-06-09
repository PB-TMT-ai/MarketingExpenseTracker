import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * E2E for Plan 04-04 — the /dashboard compliance & spend view.
 *
 * Four tests lock the Phase 4 headline behaviors:
 *   1. DASH-01 — StatStrip renders non-zero after a Done execution; `/` → `/dashboard`.
 *   2. DASH-04 — selecting a Region in the FilterBar narrows the stat numbers + URL.
 *   3. DASH-06 — weekly trend chart renders an SVG; the "4w" toggle writes ?mode/?weeks.
 *   4. DASH-07 — the geo drill tree expands Zone→State and metrics aggregate upward.
 *
 * Data-slot selectors used (kept here so future test authors find them):
 *   [data-slot="stat-strip"]                — the headline numbers card (DASH-01)
 *   [data-slot="stat-pct-executed"]         — % executed <dd> (DASH-01/04)
 *   [data-slot="stat-planned-units"]        — planned-units <dd> (DASH-04)
 *   [data-slot="dashboard-filter-region"]   — region multi-select (DASH-04)
 *   [data-slot="weekly-trend-chart"]        — Recharts trend island (DASH-06)
 *   [data-slot="rolling-n-toggle"]          — Period/4w/8w/12w toggle (DASH-06)
 *   [data-slot="geo-drill-tree"]            — nested <details> tree (DASH-07)
 *   [data-level="zone|state|district|taluka"] + [data-planned] — tree node math (DASH-07)
 *
 * Conventions mirror e2e/actuals.spec.ts: DEV_PASSWORD, login(), createActivePeriod(),
 * plan upload via the real UI, executions seeded via the gated /api/test/seed-execution
 * route. Single worker (fullyParallel:false). No DB mocking; auth cookie always set.
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
  const label = `Dashboard E2E ${Date.now()}`;
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

/** Upload + commit a counter-wall plan fixture; returns the committed periodId. */
async function uploadGeoPlan(page: Page, expectRows: number): Promise<string> {
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
  const periodId = await page
    .locator('select[data-slot="period-select"] option:checked')
    .getAttribute("value");
  expect(periodId).toBeTruthy();
  return periodId as string;
}

/** Seed one execution by SFID via the gated test route, controlling status/cost/date. */
async function seedExecution(
  request: APIRequestContext,
  page: Page,
  args: {
    periodId: number;
    sfid: string;
    status?: string;
    totalCost?: number;
    executionDate?: string;
  },
): Promise<void> {
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const resp = await request.post("/api/test/seed-execution", {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: { activity: "counter-wall", ...args },
  });
  expect(resp.status(), `seed-execution: ${await resp.text()}`).toBe(200);
}

/** Parse the first numeric run out of a stat <dd>'s text (handles ₹, %, commas). */
function firstNumber(text: string): number {
  const m = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

// ---------------------------------------------------------------------------
// Test 1 — DASH-01: StatStrip non-zero + root redirect
// ---------------------------------------------------------------------------

test("DASH-01: StatStrip shows non-zero after a Done execution; / redirects to /dashboard", async ({
  page,
  request,
}) => {
  await login(page);
  await createActivePeriod(page);
  const periodId = await uploadGeoPlan(page, 16);

  // One Done execution → % Executed must be > 0.
  await seedExecution(request, page, {
    periodId: Number(periodId),
    sfid: "SF-GEO-001",
    status: "Done",
    totalCost: 5000,
    executionDate: "2026-09-07",
  });

  // Root redirects to /dashboard (DASH-01 — no manual nav).
  await page.goto("/");
  await page.waitForURL("**/dashboard", { timeout: 10_000 });

  await expect(page.locator('[data-slot="stat-strip"]')).toBeVisible();

  // % Executed is non-zero.
  const pctText =
    (await page.locator('[data-slot="stat-pct-executed"]').textContent()) ?? "";
  expect(firstNumber(pctText)).toBeGreaterThan(0);

  // Planned units reflects the 16-row plan.
  const plannedText =
    (await page.locator('[data-slot="stat-planned-units"]').textContent()) ?? "";
  expect(firstNumber(plannedText)).toBe(16);
});

// ---------------------------------------------------------------------------
// Test 2 — DASH-04: Region filter narrows the numbers
// ---------------------------------------------------------------------------

test("DASH-04: selecting a Region narrows the planned-units stat and writes ?region", async ({
  page,
  request,
}) => {
  await login(page);
  await createActivePeriod(page);
  const periodId = await uploadGeoPlan(page, 16);

  // A couple of Done executions so the % stat is meaningful too.
  await seedExecution(request, page, {
    periodId: Number(periodId),
    sfid: "SF-GEO-001",
    status: "Done",
    executionDate: "2026-09-07",
  });

  await page.goto("/dashboard");
  await expect(page.locator('[data-slot="stat-strip"]')).toBeVisible();

  // Baseline: 16 planned units across North + South (8 each).
  const baselineText =
    (await page.locator('[data-slot="stat-planned-units"]').textContent()) ?? "";
  const baseline = firstNumber(baselineText);
  expect(baseline).toBe(16);

  // Select North in the region multi-select.
  await page.selectOption('[data-slot="dashboard-filter-region"]', "North");
  await page.waitForURL(/[?&]region=North/, { timeout: 10_000 });
  await page.waitForLoadState("networkidle");

  // Planned units must drop (8 of 16 are North).
  const narrowedText =
    (await page.locator('[data-slot="stat-planned-units"]').textContent()) ?? "";
  const narrowed = firstNumber(narrowedText);
  expect(narrowed).toBeLessThan(baseline);
  expect(narrowed).toBe(8);
});

// ---------------------------------------------------------------------------
// Test 3 — DASH-06: weekly trend chart renders + rolling-N toggle writes URL
// ---------------------------------------------------------------------------

test("DASH-06: weekly trend chart renders an SVG and the 4w toggle writes ?mode=rolling&weeks=4", async ({
  page,
  request,
}) => {
  await login(page);
  await createActivePeriod(page);
  const periodId = await uploadGeoPlan(page, 16);

  // Two Done executions on DIFFERENT ISO weeks → ≥ 1 chart bucket.
  await seedExecution(request, page, {
    periodId: Number(periodId),
    sfid: "SF-GEO-001",
    status: "Done",
    totalCost: 1000,
    executionDate: "2026-09-07", // ISO week of Mon 2026-09-07
  });
  await seedExecution(request, page, {
    periodId: Number(periodId),
    sfid: "SF-GEO-002",
    status: "Done",
    totalCost: 2000,
    executionDate: "2026-09-21", // a later ISO week
  });

  await page.goto("/dashboard");

  const trend = page.locator('[data-slot="weekly-trend-chart"]');
  await expect(trend).toBeVisible();
  // Recharts renders an <svg>; ResponsiveContainer needs a tick to size.
  await expect
    .poll(async () => await trend.locator("svg").count(), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);

  // Click the 4w toggle → URL gains the rolling params.
  await page
    .locator('[data-slot="rolling-n-toggle"] [data-weeks="4"]')
    .click();
  await page.waitForURL(/[?&]mode=rolling/, { timeout: 10_000 });
  await expect(page).toHaveURL(/[?&]weeks=4/);
});

// ---------------------------------------------------------------------------
// Test 4 — DASH-07: geo drill tree expands + metrics aggregate upward
// ---------------------------------------------------------------------------

test("DASH-07: drill tree expands Zone→State and a Zone's planned equals the sum of its States", async ({
  page,
}) => {
  await login(page);
  await createActivePeriod(page);
  await uploadGeoPlan(page, 16);

  await page.goto("/dashboard");

  const tree = page.locator('[data-slot="geo-drill-tree"]');
  await expect(tree).toBeVisible();

  // Grab the first Zone-level node (North).
  const zone = tree.locator('details[data-level="zone"]').first();
  await expect(zone).toBeVisible();
  const zonePlanned = Number(await zone.getAttribute("data-planned"));
  expect(zonePlanned).toBe(8); // 8 of 16 rows are in North

  // Expand the zone (click its summary) and assert the State children appear.
  await zone.locator("summary").first().click();
  const states = zone.locator('details[data-level="state"]');
  await expect(states.first()).toBeVisible({ timeout: 5_000 });
  const stateCount = await states.count();
  expect(stateCount).toBe(2); // StateA + StateB

  // Sum the visible States' planned counts — must equal the Zone's planned (upward agg).
  let sum = 0;
  for (let i = 0; i < stateCount; i += 1) {
    sum += Number(await states.nth(i).getAttribute("data-planned"));
  }
  expect(sum).toBe(zonePlanned);
});
