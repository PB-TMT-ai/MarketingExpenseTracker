import { test, expect } from "@playwright/test";

/**
 * Foundation E2E: the proxy.ts gate + login flow.
 *
 * This is the harness's own self-test — if these fail, every later Playwright spec is
 * invalid. Covers the same surface that was human-verified at the 01-01 checkpoint, now
 * driven by Chrome instead of by hand.
 */

const DEV_PASSWORD = "jsw-marketing-2026"; // matches .env.local; harmless in the public spec

test("GET / without a session redirects to /login", async ({ page }) => {
  // Strip the session cookie to simulate a logged-out browser.
  await page.context().clearCookies();
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("input[name=password]")).toBeVisible();
});

test("wrong password shows an inline error, no cookie set", async ({ page, context }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", "definitely-not-the-password");
  await page.click("button[type=submit]");
  await expect(page.getByText(/incorrect password/i)).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "session")).toBeUndefined();
});

test("correct password lands on the app shell and Log out clears the session", async ({
  page,
  context,
}) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=password]", DEV_PASSWORD);
  await page.click("button[type=submit]");

  // After successful login, the form's onSuccess navigates to "/".
  await page.waitForURL("/", { timeout: 10_000 });
  await expect(page.getByText(/foundation ready/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();

  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "session")?.httpOnly).toBe(true);

  await page.click("button:has-text('Log out')");
  await page.waitForURL(/\/login$/);
  const after = await context.cookies();
  expect(after.find((c) => c.name === "session")).toBeUndefined();
});
