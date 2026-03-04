#!/bin/sh
# Run Playwright e2e tests. Use a clean PATH so system Node is used
# (avoids Deno's node compat when invoked via deno task).
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
npx playwright test --config=e2e/playwright.config.ts "$@" &&
  npx playwright test --config=e2e/playwright-blank-slate.config.ts "$@"
