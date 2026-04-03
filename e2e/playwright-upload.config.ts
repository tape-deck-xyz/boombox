/** @file Playwright config for upload flow E2E (mutates E2E S3 session store). */
import { defineConfig, devices } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./",
  testMatch: "upload-flow.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
    command: "E2E_EMPTY=1 deno task start:e2e",
    url: "http://localhost:8000",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
