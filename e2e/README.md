# E2E Tests

Playwright-based end-to-end and visual regression tests for BoomBox.

## Running tests

```bash
deno task test:e2e
```

This runs **three** Playwright configs in sequence (see [Configs](#configs)
below). Build the client first: `deno task build`.

## Configs

Tests use **three** Playwright configs because they require different server
states:

| Config                             | Server task                       | S3 state                                        | Tests                            |
| ---------------------------------- | --------------------------------- | ----------------------------------------------- | -------------------------------- |
| `playwright.config.ts`             | `start:e2e`                       | Fixture albums (Test Artist / Test Album)       | index, album, admin-auth, visual |
| `playwright-blank-slate.config.ts` | `E2E_EMPTY=1 deno task start:e2e` | Empty (no albums)                               | blank-slate                      |
| `playwright-upload.config.ts`      | `E2E_EMPTY=1 deno task start:e2e` | Empty at startup; upload mutates in-memory mock | upload-flow                      |

The main config excludes `blank-slate.spec.ts` and `upload-flow.spec.ts` via
`testIgnore` so those suites only run under their dedicated configs (correct
`E2E_EMPTY` / isolated server). The `run-e2e.sh` script runs all three configs
in order.

## Environment variables

- **E2E_MODE=1** — Enables the S3 mock (required for all suites).
- **E2E_EMPTY=1** — When set with E2E_MODE, listing starts empty before any
  uploads. Used by blank-slate and upload configs.

## Test files

| File                  | Coverage                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| `index.spec.ts`       | Home page with "Latest" album row and fixture data                              |
| `album.spec.ts`       | Album detail page                                                               |
| `admin-auth.spec.ts`  | Admin Basic Auth flow and upload button visibility                              |
| `visual.spec.ts`      | Visual regression (screenshot baselines); includes admin toolbar (both buttons) |
| `blank-slate.spec.ts` | Empty state when no albums (non-admin and admin)                                |
| `upload-flow.spec.ts` | Admin upload dialog → home shows new album → album page shows tracks            |

## Running a single suite

```bash
# Main suite only (fixture data)
npx playwright test --config=e2e/playwright.config.ts

# Blank slate suite only (empty S3)
deno task test:e2e:blank-slate

# Upload flow only (empty S3, isolated server)
deno task test:e2e:upload
```

## Updating visual baselines

```bash
deno task test:e2e -- --update-snapshots
```

This updates screenshot baselines. For the main config:
`deno task test:e2e -- --update-snapshots` (note: the first `--` passes through
to the first playwright run). For blank slate only:
`npx playwright test --config=e2e/playwright-blank-slate.config.ts --update-snapshots`.
