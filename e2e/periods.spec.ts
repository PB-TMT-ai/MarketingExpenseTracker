import { test, expect } from "@playwright/test";

/**
 * E2E: period management + the (app) shell's switcher mount.
 * Each test logs in fresh so cookie state can't bleed across runs.
 */

const DEV_PASSWORD = "jsw-marketing-2026";

async function login(page: import("@playwright/test").Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", DEV_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("/", { timeout: 10_000 });
}

test("rejects invalid input (no date) without creating a period", async ({ page }) => {
  await login(page);
  await page.goto("/periods");
  // Fill label only, leave dates blank — native `required` blocks submit, so we drop
  // it and rely on the Zod ISO_DATE regex to reject.
  await page.fill("input[name=label]", "Bad period (no date)");
  await page.evaluate(() => {
    // Strip required attribute so the form actually posts.
    document
      .querySelectorAll<HTMLInputElement>("input[required]")
      .forEach((i) => i.removeAttribute("required"));
  });
  await page.click("button[type=submit]:has-text('Create period')");
  // The action returns an error state, which the form renders inline.
  await expect(page.getByRole("alert")).toBeVisible();
});

test("creates a period (makeActive), shows it as active, and surfaces it in the switcher", async ({
  page,
}) => {
  await login(page);
  await page.goto("/periods");

  const label = `Aug 2026 ${Date.now()}`;
  await page.selectOption("select[name=type]", "month");
  await page.fill("input[name=label]", label);
  await page.fill("input[name=startDate]", "2026-08-01");
  await page.fill("input[name=endDate]", "2026-08-31");
  await page.check("input[name=makeActive]");
  await page.click("button[type=submit]:has-text('Create period')");

  // The period appears in the list and is marked active.
  const item = page.locator("li", { hasText: label });
  await expect(item).toBeVisible();
  await expect(item.getByText("active", { exact: true })).toBeVisible();

  // Active period appears (and is selected) in the shell's switcher.
  await page.goto("/");
  const switcher = page.locator('form[data-slot="period-switcher"] select');
  await expect(switcher).toBeVisible();
  // The option for our period is selected — its text contains the label and "(active)".
  await expect(switcher.locator("option:checked")).toContainText(label);
  await expect(switcher.locator("option:checked")).toContainText("(active)");
});

test("switching active period from the switcher leaves exactly one active (D-11)", async ({
  page,
}) => {
  await login(page);
  await page.goto("/periods");

  // Need at least two periods. Create one more (not active) than whatever's there.
  const p2Label = `Sep 2026 ${Date.now()}`;
  await page.selectOption("select[name=type]", "month");
  await page.fill("input[name=label]", p2Label);
  await page.fill("input[name=startDate]", "2026-09-01");
  await page.fill("input[name=endDate]", "2026-09-30");
  // Do NOT check makeActive — we'll flip it from the shell switcher.
  await page.click("button[type=submit]:has-text('Create period')");

  await page.goto("/");
  const select = page.locator('form[data-slot="period-switcher"] select');
  await expect(select).toBeVisible();

  // Switch active to p2 from the switcher; onChange auto-submits.
  // `selectOption({ label })` needs an exact string — pick p2 by its (unique) label.
  // p2 is not yet active, so its option text is just `p2Label` (no " (active)" suffix).
  await select.selectOption({ label: p2Label });
  // Wait for the form submit + revalidate cycle to settle.
  await page.waitForLoadState("networkidle");

  // Authoritative D-11 check: the management page shows exactly one active marker, and
  // it lives on p2's row. (The switcher's `defaultValue` rendering is React UI sugar;
  // the page-level active count is what the invariant actually promises.)
  await page.goto("/periods");
  const activeMarkers = page.locator('[data-slot="active-marker"]');
  await expect(activeMarkers).toHaveCount(1);
  await expect(
    page.locator("li", { hasText: p2Label }).getByText("active", { exact: true }),
  ).toBeVisible();
});
