/** @file Playwright configuration for e2e and visual regression tests.
 *
 * Starts the Deno server with mocked S3 (E2E_MODE) before tests. Uses Chromium
 * for consistency. Screenshot baselines go in e2e/album-page.spec.ts-snapshots/
 * (or similar) and are git-tracked.
 */
import { defineConfig, devices } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./",
  testIgnore: ["**/blank-slate.spec.ts", "**/upload-flow.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      pathTemplate:
        "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: "deno task start:e2e",
    url: "http://localhost:8000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
