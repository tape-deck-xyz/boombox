/** @file E2E tests for admin Basic Auth flow.
 *
 * Verifies that incorrect credentials return 401 and do not log in, and that
 * correct credentials redirect to home and show the upload button.
 */
import { expect, test } from "@playwright/test";

test("admin with incorrect credentials does not log in", async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: "wrong", password: "wrong" },
  });
  const page = await context.newPage();
  try {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(401);
    const body = await response?.text();
    expect(body).toContain("Unauthorized");
  } finally {
    await context.close();
  }
});

test("admin with correct credentials logs in and sees upload button", async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: "e2e-admin", password: "e2e-secret" },
  });
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("upload-dialog-custom-element")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: "add files" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Refresh library" }),
    ).toBeVisible({ timeout: 5_000 });
  } finally {
    await context.close();
  }
});
