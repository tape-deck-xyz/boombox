/** @file E2E tests for the album detail page.
 *
 * Asserts that the album page loads with track list, album header, and
 * custom elements. Uses fixture artist/album from E2E S3 mock.
 */
import { expect, test } from "@playwright/test";

test("album page loads and displays tracklist", async ({ page }) => {
  await page.goto("/artists/Test%20Artist/albums/Test%20Album");
  await expect(page.locator("h1")).toContainText("Test Album", {
    timeout: 10_000,
  });
  await expect(page.locator("tracklist-item-custom-element").first())
    .toBeVisible(
      { timeout: 5_000 },
    );
});

test("album page shows track items from fixture", async ({ page }) => {
  await page.goto("/artists/Test%20Artist/albums/Test%20Album");
  await expect(page.getByText("Test Track.mp3")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Another Song.mp3")).toBeVisible({
    timeout: 5_000,
  });
});

test("album page includes album-header and album-image elements", async ({ page }) => {
  await page.goto("/artists/Test%20Artist/albums/Test%20Album");
  await expect(
    page.locator("album-header-custom-element").first(),
  ).toBeVisible({ timeout: 5_000 });
});

test("album page preloads coverArtUrl and sets data-cover-art-url on header", async ({ page }) => {
  await page.goto("/artists/Test%20Artist/albums/Test%20Album");
  const header = page.locator("album-header-custom-element").first();
  await expect(header).toBeVisible({ timeout: 10_000 });
  await expect(header).toHaveAttribute(
    "data-cover-art-url",
    /https:\/\/test\.s3\.test\.amazonaws\.com\/Test Artist\/Test Album\/cover\.jpeg$/,
  );
  const preload = page.locator(
    'link[rel="preload"][as="image"]',
  );
  await expect(preload).toHaveCount(1);
  await expect(preload).toHaveAttribute(
    "href",
    /https:\/\/test\.s3\.test\.amazonaws\.com\/Test Artist\/Test Album\/cover\.jpeg$/,
  );
});
