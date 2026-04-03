/** @file E2E happy path: admin uploads tracks and sees album on home + track list. */
import { expect, test } from "@playwright/test";
import path from "node:path";
import process from "node:process";

test("admin uploads file and sees album on home and tracks on album page", async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: "e2e-admin", password: "e2e-secret" },
  });
  const page = await context.newPage();
  try {
    const audioPath = path.join(process.cwd(), "test_data/no-cover.mp3");

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Upload album" }).click();
    await expect(
      page.getByRole("heading", { name: "Upload files" }),
    ).toBeVisible({ timeout: 5_000 });

    const fileInput = page.locator("upload-dialog-custom-element").locator(
      'input[type="file"]',
    );
    await fileInput.setInputFiles(audioPath);

    await expect(page.getByText("Loading…")).not.toBeVisible({
      timeout: 15_000,
    });

    const artist = "Playwright Upload Artist";
    const album = "Playwright Upload Album";
    const title = "Playwright Track One";

    await page.getByLabel("Artist").fill(artist);
    await page.getByLabel("Album").fill(album);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Track number").fill("1");

    await Promise.all([
      page.waitForURL(/\/$/, { timeout: 30_000 }),
      page.getByRole("button", { name: "Upload", exact: true }).click(),
    ]);

    await expect(page.getByText("Latest")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(album)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(artist)).toBeVisible({ timeout: 5_000 });

    await page.getByRole("link", { name: new RegExp(album, "i") }).click();
    await expect(page.locator("h1")).toContainText(album, { timeout: 10_000 });
    await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
  } finally {
    await context.close();
  }
});
