/** @file E2E tests for blank slate (empty home page). */
import { expect, test } from "@playwright/test";

test("blank slate shows when no albums", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nothing here yet.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Check back later.")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator("musical-note-icon")).toBeAttached({
    timeout: 5_000,
  });
  await expect(page.locator("main")).toHaveScreenshot(
    "blank-slate-main.png",
    { timeout: 10_000 },
  );
});

test("blank slate admin shows upload CTA", async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: "e2e-admin", password: "e2e-secret" },
  });
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("No albums yet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: "Upload album" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("main")).toHaveScreenshot(
      "blank-slate-admin-main.png",
      { timeout: 10_000 },
    );
  } finally {
    await context.close();
  }
});

test("blank slate admin clicking Upload album opens upload dialog", async ({
  browser,
}) => {
  const context = await browser.newContext({
    httpCredentials: { username: "e2e-admin", password: "e2e-secret" },
  });
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("button", { name: "Upload album" }),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Upload album" }).click();

    await expect(
      page.getByRole("heading", { name: "Upload files" }),
    ).toBeVisible({ timeout: 5_000 });
  } finally {
    await context.close();
  }
});
