import { test, expect } from "@playwright/test";

/**
 * E2E: item-master management page.
 * D-09 invariant verified at the UI: retire flips the badge but does NOT remove the row.
 */

const DEV_PASSWORD = "jsw-marketing-2026";

async function login(page: import("@playwright/test").Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", DEV_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("/", { timeout: 10_000 });
}

test("/items rejects an empty name", async ({ page }) => {
  await login(page);
  await page.goto("/items");
  // Drop `required` so the form actually posts.
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLInputElement>("input[required]")
      .forEach((i) => i.removeAttribute("required"));
  });
  await page.click("button[type=submit]:has-text('Add item')");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("creates an item with category and lists it as active (no retired badge)", async ({
  page,
}) => {
  await login(page);
  await page.goto("/items");

  const name = `Wall stickers ${Date.now()}`;
  await page.fill("input[name=name]", name);
  await page.fill("input[name=category]", "POP");
  await page.click("button[type=submit]:has-text('Add item')");

  const row = page.locator('ul[data-slot="item-list"] > li', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row.locator('[data-slot="retired-badge"]')).toHaveCount(0);
  await expect(row.getByRole("button", { name: /retire/i })).toBeVisible();
});

test("retire flips the badge but the row survives, then restore round-trips (D-09)", async ({
  page,
}) => {
  await login(page);
  await page.goto("/items");

  const name = `Posters ${Date.now()}`;
  await page.fill("input[name=name]", name);
  await page.click("button[type=submit]:has-text('Add item')");

  // Wait for the row to land before counting (revalidatePath is async).
  const row = page.locator('ul[data-slot="item-list"] > li', { hasText: name });
  await expect(row).toBeVisible();

  // Count active items before the retire.
  const rowsBefore = await page
    .locator('ul[data-slot="item-list"] > li')
    .count();
  expect(rowsBefore).toBeGreaterThan(0);

  // Retire our row.
  await row.getByRole("button", { name: /retire/i }).click();
  await page.waitForLoadState("networkidle");

  // D-09: total row count is UNCHANGED (no DELETE), the row is now data-active="false"
  // and shows the retired badge.
  const rowsAfter = await page
    .locator('ul[data-slot="item-list"] > li')
    .count();
  expect(rowsAfter, "row count must not change on retire (no DELETE)").toBe(
    rowsBefore,
  );
  const retiredRow = page.locator('ul[data-slot="item-list"] > li', {
    hasText: name,
  });
  await expect(retiredRow).toHaveAttribute("data-active", "false");
  await expect(retiredRow.locator('[data-slot="retired-badge"]')).toBeVisible();

  // Restore round-trip: button label flipped to "Restore"; click it.
  await retiredRow.getByRole("button", { name: /restore/i }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator('ul[data-slot="item-list"] > li', { hasText: name }),
  ).toHaveAttribute("data-active", "true");
});
