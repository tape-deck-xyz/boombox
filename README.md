# BoomBox

A Deno-based music player application. Your audio where you want it—browse
artists and albums, play tracks, and (with admin) upload music to cloud storage
(S3).

- **Server**: Deno native HTTP (`Deno.serve()`), custom router, server-side
  rendering with plain HTML.
- **Client**: Custom elements (Web Components) with shadow DOM, bundled by Deno
  and loaded as `/build/main.js`.
- **Storage**: AWS S3 for track and album metadata; admin uploads via HTTP Basic
  Auth.

---

## Prerequisites

- **Deno** 1.40+
- **AWS credentials** (for S3 access; configure via environment or IAM)
- **Node.js** is not required for running the server or building the client
  bundle.

---

## Quick start

1. **Environment**\
   Copy [`.env.sample`](.env.sample) to `.env` and set `AWS_*`, `STORAGE_*`, and
   (for admin) `ADMIN_USER` / `ADMIN_PASS`. See
   [Environment variables](#environment-variables).

2. **Build the client bundle**
   ```bash
   deno task build
   ```
   This produces `build/main.js` (custom elements bundle). The server serves
   this and other static assets from `build/`, `app/app.css`, and `public/`.

3. **Run the server**
   ```bash
   deno task start
   ```
   Server runs at **http://localhost:8000** (or set `PORT` in `.env`).

---

## Environment variables

Create a `.env` file in the project root. Use [`.env.sample`](.env.sample) as a
template:

| Variable                | Purpose                            |
| ----------------------- | ---------------------------------- |
| `AWS_ACCESS_KEY_ID`     | AWS access key for S3              |
| `AWS_SECRET_ACCESS_KEY` | AWS secret for S3                  |
| `STORAGE_REGION`        | AWS region for the bucket          |
| `STORAGE_BUCKET`        | S3 bucket name                     |
| `ADMIN_USER`            | Username for admin HTTP Basic Auth |
| `ADMIN_PASS`            | Password for admin HTTP Basic Auth |
| `PUBLIC_HOSTNAME`       | Optional. Hostname (or URL) for `hostname` in `GET /info` when the server is behind a proxy. See [docs/library-catalog-and-info.md](docs/library-catalog-and-info.md) |
| `PORT`                  | Server port (default: `8000`)      |

If `ADMIN_USER` or `ADMIN_PASS` is unset or empty, admin is disabled and
protected routes return 500. See [Admin authentication](#admin-authentication).

---

## S3 bucket setup

BoomBox requires an S3 bucket for storing audio files and cover images. Below
is the minimal configuration needed.

### Bucket policy

The bucket must allow public reads (for serving audio/images) and public
listing (so the server can enumerate albums and tracks):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    },
    {
      "Sid": "PublicListBucket",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
    }
  ]
}
```

Replace `YOUR-BUCKET-NAME` with the value of your `STORAGE_BUCKET` env var.

> **Note**: `s3:ListBucket` being public means anyone can enumerate your
> bucket's contents. This is intentional for a public music library.

### CORS configuration

The browser fetches audio and cover images directly from S3, so CORS must be
enabled:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["Content-Length", "ETag"]
  }
]
```

> **Note**: Uploads are performed server-side (the Deno server calls S3
> directly using your AWS credentials), so `PUT`/`POST` methods are not
> required in the CORS policy.

### IAM permissions

The AWS credentials in your `.env` (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`) need the following permissions on the bucket:

- `s3:PutObject` — upload audio files and cover images
- `s3:GetObject` — read objects (e.g. for cover image extraction)
- `s3:ListBucket` — list albums and tracks
- `s3:HeadObject` — check whether a cover image already exists before uploading

---

## Admin authentication

Only **GET `/admin`**, **POST `/`** (upload), and **GET `/info?refresh=1`** require auth and may return 401.
The home page does not challenge; it uses the request’s `Authorization` header
to show or hide admin UI.

- **Mechanism**: HTTP Basic Auth. Credentials come from `ADMIN_USER` and
  `ADMIN_PASS`.
- **How to log in**: Visit `/admin` → browser shows username/password dialog →
  enter the same values as in `.env`. On success you are redirected to `/`; the
  browser then sends the `Authorization` header so the app shows admin-only UI
  (e.g. upload, refresh library).
- **Protected routes**:
  - **GET `/admin`** — Login entry; requires valid Basic Auth, then redirects to
    `/`.
  - **POST `/`** — File upload; requires valid Basic Auth (401 if missing).
  - **GET `/info?refresh=1`** — Force refresh of library cache; requires valid Basic Auth (401 if missing). Admins can use the refresh button in the UI.

---

## Client-side navigation

Inner-app links use the `<nav-link>` custom element (e.g. album tiles on the
home page). When the user activates a nav-link to an app route (`/` or
`/artists/:id/albums/:id`), the client fetches a **fragment** instead of loading
a full page: the server returns a JSON envelope when the request includes a
special header. The client updates the main content area, document title, head
meta (e.g. OG tags), and optional critical CSS. It uses `history.pushState`, so
back/forward works without a full reload.

### Fragment protocol (detail)

- **Request**: For same-origin GETs to app paths (any path starting with `/`),
  `<nav-link>` sends a `fetch()` with the header `X-Requested-With: fetch`.
  Modifier clicks (e.g. Cmd+click) and cross-origin links are left to the
  browser (no fragment request).
- **Response**: If the server sees `X-Requested-With: fetch`, it responds with
  `Content-Type: application/json` and a JSON envelope instead of a full HTML
  document. If the header is absent (e.g. direct load, refresh, new tab), the
  server returns the full HTML page as usual.
- **Envelope shape** (see `lib/fragment-envelope.ts`):
  - `title` (string) — document title.
  - `html` (string) — inner HTML for the `<main>` element.
  - `meta` (optional array) — head meta tags: each item has `property` (e.g.
    `og:title`) or `name` (e.g. `description`) and `content`. The client creates
    or updates `<meta>` tags and clears previous fragment-managed OG tags when
    applying.
  - `styles` (optional string) — critical CSS for the page (e.g. a single
    `<style>...</style>` block or raw CSS). Injected into a
    `<style id="fragment-critical-styles">` in `<head>`; removed if the envelope
    omits `styles`.
- **Client behavior**: On success, the client sets `main.innerHTML`,
  `document.title`, meta tags, and optional critical styles, then
  `history.pushState(url, title, url)`. On fetch failure it falls back to full
  navigation (`location.href`). On `popstate`, it re-fetches the current URL
  with the fragment header and applies the envelope; after several consecutive
  failures it shows an error message instead of reloading.

### Adding new routes that support fragments

To add a new app route that can be loaded as a fragment (so `<nav-link>` to it
does not trigger a full page load):

1. **Register the route** in `server/main.ts`:
   ```ts
   router.add({
     pattern: "/your-path",
     handler: handleYourPage,
     method: "GET",
   });
   // Or with params: pattern: "/artists/:artistId/albums/:albumId"
   ```

2. **Implement the handler** (e.g. in `server/handlers/your-page.html.ts`):
   - Build the **main content HTML** (the markup that goes inside `<main>`), the
     same for both full page and fragment.
   - If the request is a fragment request, return a JSON envelope instead of a
     full document:
     ```ts
     import { isFragmentRequest } from "../ssr.ts";
     import type { FragmentMetaItem } from "../ssr.ts";

     if (isFragmentRequest(req)) {
       const envelope = {
         title: "Your Page Title",
         html: mainContentHtml,
         meta: [/* optional: { property: "og:title", content: "..." } etc. */],
         styles: "optional critical CSS string",
       };
       return new Response(JSON.stringify(envelope), {
         headers: { "Content-Type": "application/json" },
       });
     }
     ```
   - Otherwise call `renderPage(...)` and return the full HTML document (same as
     existing handlers like `handleIndexHtml` and `handleAlbumHtml`).

3. **Use `<nav-link>`** in your HTML so in-app navigation requests the fragment:
   ```html
   <nav-link href="/your-path">Your label</nav-link>
   ```

The client treats any same-origin path starting with `/` as an app route and
will send the fragment header when navigating via `<nav-link>`. No client
changes are required for new routes; only the server handler must support
`isFragmentRequest(req)` and return the envelope when true.

---

## Building

- **Custom elements bundle** (required for the UI):
  ```bash
  deno task build
  ```
  Output: `build/main.js`. The server serves it at `/build/main.js`.

- **Generated API docs** (optional):
  ```bash
  deno task build:docs
  ```
  Output: `docs/` (HTML). See [Documentation](#documentation).

---

## Running the server

| Mode                    | Command           |
| ----------------------- | ----------------- |
| **Development** (watch) | `deno task start` |
| **Production**          | `deno task start` |

Or run directly:

```bash
# Development (with --watch)
deno run --allow-net --allow-env --allow-read --allow-write --allow-sys --watch server/main.ts

# Production
deno run --allow-net --allow-env --allow-read --allow-write --allow-sys server/main.ts
```

The `--allow-sys` flag is required for AWS SDK compatibility.

---

## Testing

Run the full test suite:

```bash
deno task test:all
```

This runs: `test:doc`, `test:release`, `test:components`, `test:util`, and
`test:server` (Deno tests under `tests/`).

- **Coverage**: CI uses `deno task test:coverage:ci` to run tests with coverage
  and enforce a baseline. See [Coverage](#coverage) below.
- **Server / integration tests**: `tests/` — see
  [tests/README.md](tests/README.md) for structure and how to run individual
  tests.
- **Component tests**: `deno test app/components/ --no-check`
- **Util tests**: `deno test app/util --no-check --allow-env --allow-read`

### Coverage

Tests run with coverage and are compared against `coverage-baseline.json`. If
line, branch, or function coverage drops below the baseline, the push or CI
fails.

- **Pre-push**: The `.husky/pre-push` hook runs `deno task test:coverage:ci`,
  which executes `deno task test:coverage:ci`. The push is blocked if coverage
  regresses.
- **CI**: The test job runs `deno task test:coverage:ci`.
- **Baseline updates**: The baseline is updated automatically only when a new
  version is released (CircleCI release job). When merging to `main` triggers a
  release, the job runs `deno task coverage:baseline` and commits the updated
  `coverage-baseline.json` with the release commit.

| Task                | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `test:coverage`     | Run all tests with coverage (outputs to `cov/`)                   |
| `coverage:check`    | Generate LCOV from `cov/`, compare to baseline, exit 0 or 1       |
| `test:coverage:ci`  | Run `test:coverage` + `coverage:check` (single invocation)        |
| `coverage:baseline` | Run tests, then write new percentages to `coverage-baseline.json` |

**Raising the bar**: Coverage baseline is raised automatically at release time.
See
[Updating the baseline during development](#updating-the-baseline-during-development)
for when and how to update it locally.

#### Updating the baseline during development

The baseline only updates automatically when a release happens. During
development, update it locally when:

- **You added or improved tests** — run `coverage:baseline` and commit the
  updated `coverage-baseline.json` to raise the bar for future work.
- **Pre-push fails** due to coverage check — if the baseline is missing or
  corrupted, run `coverage:baseline` to create/refresh it. If coverage regressed
  (dropped below baseline), fix it by adding tests or restoring code; do not
  lower the baseline.

**Workflow when adding tests:**

1. Add or update tests; run `deno task test:coverage:ci` to confirm tests pass.
2. Run `deno task coverage:baseline` to write the new percentages.
3. Commit `coverage-baseline.json` with your test changes (or in a follow-up
   commit).

**When to run `coverage:baseline`:**

| Situation                          | Action                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| You added tests, coverage went up  | Run `coverage:baseline`, commit the updated file to raise the bar. |
| Pre-push fails (baseline missing)  | Run `coverage:baseline` to create it; commit.                      |
| Coverage regressed (dropped below) | Add tests or restore code; do not lower the baseline.              |
| Release merged to `main`           | Baseline is updated automatically by CI; no local action needed.   |

### E2E and visual regression

Browser-based e2e and visual regression tests use Playwright in `e2e/`.

- **Run e2e**: `deno task test:e2e` (starts the server with mocked S3, runs
  Playwright)
- **Update visual baselines**: `deno task test:e2e -- --update-snapshots`
- **CI**: The `test-e2e` job runs after build; release requires both unit and
  e2e tests to pass.

Tasks: `start:e2e` (server with E2E_MODE + S3 mock), `test:e2e` (Playwright),
`test:browser` (alias for `test:e2e`).

---

## Release automation

- Application version is tracked in `deno.json` under `version`.
- A release helper script (`scripts/release.ts`) reads conventional commits
  since the previous semantic version tag and calculates the next version:
  - `BREAKING CHANGE` or `!` in the commit header: **major**
  - `feat`: **minor**
  - `fix` / `perf` / `revert`: **patch**
- Release notes are generated from conventional commits (all types), grouped by
  scope with breaking changes in a dedicated section. Notes are written to
  `release-notes.md` for the tag message and used to update `CHANGELOG.md`.
- CircleCI runs the release job only on `main` after tests pass. When a bump is
  required, it updates `deno.json` and `CHANGELOG.md`, updates
  `coverage-baseline.json` with current coverage, commits
  `chore(release): vX.Y.Z`, creates branch `release/X.Y.Z`, pushes the branch and
  annotated tag `vX.Y.Z` with the release notes, opens a PR into `main`, and
  enables auto-merge. The PR merges automatically once CI passes, satisfying
  branch protection rules that require changes via pull request. Ensure
  **Allow auto-merge** is enabled in GitHub repo settings (Settings → General →
  Pull Requests).

Local dry run (prints next version and release notes preview):

```bash
deno run --allow-read --allow-run scripts/release.ts --dry-run
```

---

## Project structure

```
.
├── app/                    # UI and shared logic
│   ├── components/         # Custom elements and HTML helpers
│   │   ├── Layout/PlayBar/ # Play bar, playlist, controls
│   │   ├── register-custom-elements.ts
│   │   └── ...
│   ├── icons/              # Heroicons-based icons
│   ├── util/               # Utilities (files, ID3, S3 client, etc.)
│   └── app.css             # Global styles
├── server/                 # Deno server
│   ├── main.ts             # Entry point, static files, router
│   ├── router.ts           # Custom route matcher
│   ├── ssr.ts              # HTML page shell and layout (SSR)
│   ├── handlers/           # Route handlers (index, album, upload, cover)
│   └── utils/              # basicAuth, loadEnv, manifest
├── build/                  # Build output
│   └── main.js             # Custom elements bundle (from deno task build)
├── e2e/                    # Playwright e2e and visual regression tests
├── tests/                  # Deno tests (router, handlers, SSR, utils)
├── scripts/                # CI/release scripts
├── public/                 # Static assets (e.g. favicon)
├── test_data/              # Test audio files (see test_data/README.md)
├── docs/                   # Generated API docs (deno task build:docs)
├── deno.json               # Config, tasks, imports
└── doc.exports.ts          # Exports used for generated docs
```

---

## Routes

| Method + path                                  | Description                                            |
| ---------------------------------------------- | ------------------------------------------------------ |
| `GET /`                                        | Home page (admin UI shown when logged in via `/admin`) |
| `GET /admin`                                   | Admin login (Basic Auth); redirects to `/` on success  |
| `POST /`                                       | File upload (requires admin Basic Auth)                |
| `GET /info`                                    | Library info JSON (aggregators; optional anon when `ALLOW_PUBLIC_INFO_JSON` is not `false`). Full semantics: [docs/library-catalog-and-info.md](docs/library-catalog-and-info.md) |
| `GET /artists/:artistId/albums/:albumId`       | Album detail page                                      |
| `GET /artists/:artistId/albums/:albumId/cover` | Album cover image (from first track’s ID3)             |

Static assets: `/build/*`, `/assets/*` (if present), `/favicon.ico`, `/app.css`.

---

## Documentation

- **Library catalog & `GET /info`**: [docs/library-catalog-and-info.md](docs/library-catalog-and-info.md)
- **Generated API docs**: Run `deno task build:docs` and open `docs/index.html`.
  Built from [doc.exports.ts](doc.exports.ts).
- **Custom elements**: See
  [.cursor/rules/custom-elements.mdc](.cursor/rules/custom-elements.mdc) for the
  shadow DOM / template pattern and naming.
- **Project conventions**: Deno-first, testing, and UI approach are described in
  [.cursor/rules/project.mdc](.cursor/rules/project.mdc).
- **Test layout and coverage**: [tests/README.md](tests/README.md).
- **Test audio files**: [test_data/README.md](test_data/README.md).

---

## Architecture notes

- The server uses Deno’s native HTTP server and a small custom router (no
  framework).
- SSR is done manually: handlers call `renderPage()` in `server/ssr.ts`, which
  returns full HTML including the custom elements script (`/build/main.js`).
  When the client requests a fragment (header `X-Requested-With: fetch`),
  handlers return a JSON envelope `{ title, html, meta?, styles?, libraryContents? }` instead of a
  full document (see [docs/library-catalog-and-info.md](docs/library-catalog-and-info.md) for catalog embedding).
- The client is built from custom elements registered in
  `app/components/register-custom-elements.ts`, bundled with
  `deno bundle --platform=browser` to `build/main.js`.
- File uploads use `Request.formData()`; S3 integration uses AWS SDK v3 via npm
  specifiers in `deno.json`.

---

## Troubleshooting

| Issue                     | What to do                                                   |
| ------------------------- | ------------------------------------------------------------ |
| Port in use               | Set `PORT` (e.g. `PORT=3000 deno task start`).               |
| Client bundle not found   | Run `deno task build` so `build/main.js` exists.             |
| 500 on `/admin` or upload | Set both `ADMIN_USER` and `ADMIN_PASS` in `.env`.            |
| Import errors             | Use `.ts` / `.tsx` extensions in imports for Deno.           |
| S3 errors                 | Check `AWS_*` and `STORAGE_*` in `.env`; see [S3 bucket setup](#s3-bucket-setup) for required bucket policy, CORS, and IAM permissions. |

---

## License and references

- Icons: [Heroicons](https://heroicons.com).
- Custom elements pattern:
  [Gold Standard Wiki](https://github.com/webcomponents/gold-standard/wiki).
