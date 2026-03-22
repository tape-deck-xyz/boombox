#!/usr/bin/env node
/** One-off: capture admin page screenshot for visual verification. */
import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  httpCredentials: { username: "e2e-admin", password: "e2e-secret" },
  viewport: { width: 1280, height: 720 },
});
const page = await context.newPage();
await page.goto("http://localhost:8000/admin");
await page.waitForURL(/\/$/);
await page.screenshot({ path: "admin-page-screenshot.png" });
await browser.close();
console.log("Screenshot saved to admin-page-screenshot.png");
