/** @file E2E tests for the index (home) page.
 *
 * Asserts that the home page loads and displays the "Latest" album row with
 * fixture data (Test Artist / Test Album).
 */
import { expect, test } from "@playwright/test";

test("index page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Latest")).toBeVisible({ timeout: 10_000 });
});

test("index page shows Latest section with fixture album", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Latest")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Test Album")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Test Artist")).toBeVisible({ timeout: 5_000 });
});

test("index page shows site footer with label and tagline", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("site-footer-custom-element");
  await expect(footer).toBeAttached({ timeout: 10_000 });
  const label = footer.locator("#label");
  const tagline = footer.locator("#tagline");
  await expect(label).toHaveText("BoomBox", { timeout: 5_000 });
  await expect(tagline).toHaveText(
    "Built by tape-deck.xyz. Open source under MIT.",
    { timeout: 5_000 },
  );
});

test("home and in-app navigation do not GET /info without ?refresh=1", async ({
  page,
}) => {
  const bareInfoGets: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (
      req.method() === "GET" &&
      url.includes("/info") &&
      !url.includes("refresh=1")
    ) {
      bareInfoGets.push(url);
    }
  });

  await page.goto("/");
  await expect(page.getByText("Latest")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: "Test Album" }).click();
  await expect(page.getByText("Tracks")).toBeVisible({ timeout: 10_000 });

  expect(
    bareInfoGets,
    "first-party UI must use embedded catalog, not GET /info (see docs/library-catalog-and-info.md)",
  ).toEqual([]);
});
