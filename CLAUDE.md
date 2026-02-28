# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Commands

### Development

```bash
# Build the client bundle (required before running server)
deno task build

# Start the development server (with --watch)
deno task start

# Run all tests
deno task test:all

# Run specific test suites
deno task test:components  # Custom element tests
deno task test:util        # Utility tests
deno task test:server      # Server/handler tests
deno task test:e2e         # E2E and visual regression tests

# Run a single test file
deno test tests/server/router.deno.test.ts
deno test app/components/AlbumImage/album-image-custom-element.test.ts
```

### Coverage

```bash
# Run tests with coverage and enforce baseline
deno task test:coverage:ci

# Update coverage baseline (after adding/improving tests)
deno task coverage:baseline
```

Coverage is enforced against `coverage-baseline.json`. When you add or improve
tests, run `coverage:baseline` and commit the updated baseline. **Never lower
the baseline**—fix regressions by adding tests or restoring code.

### Formatting and Linting

```bash
deno fmt      # Format code
deno lint     # Lint code
```

## Architecture

### Server: Custom Router + SSR

The server uses Deno's native HTTP (`Deno.serve()`) with a custom router
(`server/router.ts`). No framework.

**Router**: Pattern-based matching with `:param` syntax. Routes are sorted by
specificity (static first, then dynamic). See `server/router.ts` for
implementation.

**SSR**: Handlers call `renderPage()` from `server/ssr.ts` to produce full HTML
documents. The document shell (head, body wrapper) is separate from the layout
(main content, PlayBar, scripts).

### Fragment Protocol: Client-Side Navigation

In-app navigation uses `<nav-link>` custom elements. When clicked, the client
requests a **fragment** instead of a full page reload:

1. **Request**: Client sends `X-Requested-With: fetch` header
2. **Response**: Server returns JSON envelope `{ title, html, meta?, styles? }`
   instead of full HTML
3. **Client behavior**: Updates `main.innerHTML`, `document.title`, meta tags,
   and optional critical CSS. Uses `history.pushState()` for back/forward
   support.

**Adding fragment-compatible routes**:

- Handler checks `isFragmentRequest(req)` from `server/ssr.ts`
- If true, return JSON envelope (see `lib/fragment-envelope.ts` for schema)
- If false, return full HTML via `renderPage()`
- Client automatically sends fragment header for all same-origin `<nav-link>`
  navigations

See README "Client-side navigation" and "Adding new routes that support
fragments" for details.

### Client: Custom Elements + Bundled JS

UI uses Web Components (custom elements with shadow DOM). All elements are
registered in `app/components/register-custom-elements.ts` and bundled to
`build/main.js` via `deno task build`.

**Custom element pattern** (see `.cursor/rules/custom-elements.mdc`):

- Use shadow DOM with `attachShadow({ mode: "open" })` in constructor
- Create template element outside the class with encapsulated styles
- Clone template into shadow root:
  `this.shadowRoot!.appendChild(template.content.cloneNode(true))`
- Naming: `[ElementName]CustomElement` class → `<element-name>` tag
- Include JSDoc with `@customElement` tag

Example custom elements: `<album-image-custom-element>`, `<nav-link>`,
`<playbar-custom-element>`, `<tracklist-item-custom-element>`.

### Storage: S3 for Audio Files

Track and album metadata stored in S3. Admin uploads via HTTP Basic Auth
(`/admin` login, `POST /` upload). AWS SDK v3 accessed via npm specifiers in
`deno.json`.

## Code Conventions

### TypeScript API Standards

From `.cursor/rules/typescript-api-standards.mdc`:

- **Max 2 args + options object**: Public functions take 0–2 required args, plus
  optional `options` object. Put optional params in the options object.
- **Export interfaces**: Export any interface used in public API signatures.
- **JSDoc**: Use JSDoc for public APIs. Use markdown (not HTML). Include code
  examples in fenced blocks.
- **Private fields**: Use `#private` syntax instead of `private` keyword
  (runtime enforcement).

### Testing Requirements

From `.cursor/rules/project.mdc`:

- **Excellent coverage**: Every change requires a new or updated test.
- **Write tests one at a time**: Run each test before moving on. Never write
  multiple tests at once.
- **No shortcuts**: Never commit/push with `--no-verify` or disable tests.

Tests live in `tests/` (server/handlers) and co-located with components
(`app/components/`, `app/util/`). E2E tests use Playwright in `e2e/`.

### UI Conventions

- **No Tailwind**: Use standard CSS. Global styles (typography, spacing, utility
  classes) go in `app/app.css`.
- **Icons**: SVG-based icons from heroicons.com (see `app/icons/`).

## Key Files and Directories

- `server/main.ts` — Entry point, static file serving, route registration
- `server/router.ts` — Custom route matcher (`:param` syntax, specificity
  sorting)
- `server/ssr.ts` — SSR utilities (`renderPage`, `renderLayout`,
  `isFragmentRequest`)
- `lib/fragment-envelope.ts` — Fragment protocol types and constants (shared
  client/server)
- `app/components/register-custom-elements.ts` — Custom element registration
  (bundled to `build/main.js`)
- `app/util/` — Shared utilities (files, ID3, S3 client, etc.)
- `server/handlers/` — Route handlers (index, album, upload, cover)
- `tests/` — Server/handler tests
- `e2e/` — Playwright E2E and visual regression tests

## Fragment Protocol Implementation Details

When adding a new route that supports client-side navigation:

1. Register route in `server/main.ts`:
   ```ts
   router.add({
     pattern: "/your-path",
     handler: handleYourPage,
     method: "GET",
   });
   ```

2. Implement handler with fragment support:
   ```ts
   import { type FragmentEnvelope, isFragmentRequest } from "../ssr.ts";

   export async function handleYourPage(
     req: Request,
     params: Record<string, string>,
   ): Promise<Response> {
     const mainContentHtml = "..."; // Build main content HTML

     if (isFragmentRequest(req)) {
       const envelope: FragmentEnvelope = {
         title: "Page Title",
         html: mainContentHtml,
         meta: [{ property: "og:title", content: "..." }], // optional
         styles: "/* optional critical CSS */", // optional
       };
       return new Response(JSON.stringify(envelope), {
         headers: { "Content-Type": "application/json" },
       });
     }

     // Full page render for direct loads
     return new Response(
       renderPage({ appName: "BoomBox", title: "..." }, [mainContentHtml]),
       {
         headers: { "Content-Type": "text/html" },
       },
     );
   }
   ```

3. Use `<nav-link>` in HTML:
   ```html
   <nav-link href="/your-path">Link Text</nav-link>
   ```

No client changes needed—`<nav-link>` automatically sends fragment header for
all same-origin app routes.
