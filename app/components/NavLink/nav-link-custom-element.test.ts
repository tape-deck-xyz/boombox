/** @file Tests for NavLinkCustomElement
 *
 * Covers client-side navigation: click on nav-link fetches fragment JSON,
 * updates main content and title, and pushes history state.
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno.
 */

import { assertEquals, assertExists } from "@std/assert";
import { Event } from "linkedom";
import type { Files } from "../../util/files.ts";
import { createLinkedomEnv, getFetchUrl } from "../test.utils.ts";

const NAVLINK_HTML = `<!DOCTYPE html>
<html><head></head><body><nav></nav><main></main></body></html>`;

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv(NAVLINK_HTML);

// ============================================================================
// MOCK STATE
// ============================================================================

const fetchCalls: { url: string; headers: Record<string, string> }[] = [];
const pushStateCalls: unknown[][] = [];
let preventDefaultCalled = false;

// ============================================================================
// FETCH HELPERS
// ============================================================================

type FragmentEnvelopeOverrides = Partial<{
  title: string;
  html: string;
  meta: { property?: string; name?: string; content: string }[];
  styles: string | undefined;
  libraryContents: Files;
}>;

/** Creates a Response with application/json Content-Type and a JSON fragment envelope. */
function createJsonFragmentResponse(
  overrides?: FragmentEnvelopeOverrides,
): Response {
  const envelope = {
    title: "New Title",
    html: "<div>new content</div>",
    meta: [] as { property?: string; name?: string; content: string }[],
    ...overrides,
  };
  return {
    ok: true,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(envelope),
  } as Response;
}

function parseFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; headers: Record<string, string> } {
  const url = getFetchUrl(input);
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v: string, k: string) => {
        headers[k] = v;
      });
    } else {
      for (
        const [k, v] of Object.entries(
          init.headers as Record<string, string>,
        )
      ) {
        headers[k] = String(v);
      }
    }
  }
  return { url, headers };
}

/** Creates a fetch that records url/headers to fetchCalls and returns the given response. */
function createFetchThatRecordsCalls(
  response: Response,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const { url, headers } = parseFetchInput(input, init);
    fetchCalls.push({ url, headers });
    return Promise.resolve(response);
  };
}

// ============================================================================
// DOM SETUP (must run before importing the element module)
// ============================================================================

type LocationLike = {
  origin: string;
  href: string;
  reload?: () => void;
};

function setupDOMEnvironment(options?: {
  location?: LocationLike;
  history?: { pushState: (...args: unknown[]) => void };
  addEventListener?: (type: string, fn: () => void) => void;
  sessionStorage?: Storage;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  fetchCalls.length = 0;
  pushStateCalls.length = 0;
  preventDefaultCalled = false;

  // Reset DOM state
  const nav = linkedomDocument.querySelector("nav");
  const main = linkedomDocument.querySelector("main");
  if (nav) nav.innerHTML = "";
  if (main) main.innerHTML = "";
  linkedomDocument.title = "";

  // Clear head of fragment-managed content (OG meta, critical styles)
  const head = linkedomDocument.head;
  const ogMeta = head.querySelectorAll('meta[property^="og:"]');
  for (const el of ogMeta) head.removeChild(el);
  const stylesEl = linkedomDocument.getElementById("fragment-critical-styles");
  if (stylesEl) stylesEl.remove();

  const defaultLocation: LocationLike = {
    origin: "http://localhost:8000",
    href: "http://localhost:8000/",
  };

  const defaultHistory = {
    pushState: (...args: unknown[]) => {
      pushStateCalls.push(args);
    },
  };

  const location = options?.location ?? defaultLocation;
  const history = options?.history ?? defaultHistory;
  const addEventListener = options?.addEventListener ?? (() => {});

  // Wire linkedom + overrides to globalThis
  (globalThis as { document: Document }).document = linkedomDocument;
  const windowWithOverrides = {
    ...linkedomWindow,
    document: linkedomDocument,
    location: location as Location,
    history: history as History,
    addEventListener: addEventListener as (
      type: string,
      fn: () => void,
    ) => void,
  };
  (globalThis as { window: Window }).window =
    windowWithOverrides as unknown as Window;

  (globalThis as { location: Location }).location = location as Location;
  (globalThis as { history: History }).history = history as History;
  (globalThis as { addEventListener: typeof globalThis.addEventListener })
    .addEventListener = addEventListener as typeof globalThis.addEventListener;

  (globalThis as { customElements: CustomElementRegistry }).customElements =
    linkedomWindow.customElements;
  (globalThis as { HTMLElement: typeof HTMLElement }).HTMLElement =
    linkedomWindow.HTMLElement;

  if (options?.sessionStorage) {
    (globalThis as { sessionStorage: Storage }).sessionStorage =
      options.sessionStorage;
  } else {
    (globalThis as { sessionStorage: Storage }).sessionStorage =
      linkedomWindow.sessionStorage;
  }

  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = linkedomWindow
    .setTimeout.bind(linkedomWindow);
  (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout =
    linkedomWindow.clearTimeout.bind(linkedomWindow);

  globalThis.fetch = options?.fetch ??
    createFetchThatRecordsCalls(createJsonFragmentResponse());
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function getMain(): HTMLElement | null {
  return linkedomDocument.querySelector("main");
}

/** Creates a nav-link in the DOM with optional attributes. Uses document.createElement
 * and appendChild so connectedCallback fires naturally when the element is connected. */
function createNavLink(
  attrs: Record<string, string> = {},
): HTMLElement {
  const nav = linkedomDocument.querySelector("nav");
  if (!nav) throw new Error("nav element not found");
  const el = linkedomDocument.createElement("nav-link");
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  nav.appendChild(el);
  return el as HTMLElement;
}

function createClickEvent(
  overrides: { metaKey?: boolean } = {},
): Event {
  const ev = new Event("click", { bubbles: true, cancelable: true }) as
    & Event
    & {
      metaKey?: boolean;
      ctrlKey?: boolean;
      button?: number;
    };
  ev.metaKey = overrides.metaKey ?? false;
  (ev as Event & { ctrlKey?: boolean }).ctrlKey = false;
  (ev as Event & { button?: number }).button = 0;
  const orig = ev.preventDefault.bind(ev);
  ev.preventDefault = () => {
    preventDefaultCalled = true;
    orig();
  };
  return ev;
}

function createKeydownEvent(): Event & { key?: string } {
  const ev = new Event("keydown", { bubbles: true, cancelable: true }) as
    & Event
    & {
      key?: string;
    };
  ev.key = "Enter";
  const orig = ev.preventDefault.bind(ev);
  ev.preventDefault = () => {
    preventDefaultCalled = true;
    orig();
  };
  return ev;
}

/** Dispatches a click event. Uses unknown cast for linkedom Event → DOM Event compatibility. */
function dispatchClick(
  el: { dispatchEvent(event: unknown): boolean },
  overrides?: { metaKey?: boolean },
): void {
  el.dispatchEvent(createClickEvent(overrides) as unknown as Event);
}

/** Dispatches a keydown Enter event. Uses unknown cast for linkedom Event → DOM Event compatibility. */
function dispatchKeydown(el: { dispatchEvent(event: unknown): boolean }): void {
  el.dispatchEvent(createKeydownEvent() as unknown as Event);
}

// ============================================================================
// TESTS
// ============================================================================

Deno.test(
  "NavLinkCustomElement - popstate triggers fetch and applyEnvelope",
  async () => {
    const popstateUrl = "http://localhost:8000/artists/a/albums/b";
    let popstateListener: ((ev?: Event) => void) | null = null;

    setupDOMEnvironment({
      location: {
        origin: "http://localhost:8000",
        get href() {
          return popstateUrl;
        },
      },
      history: { pushState: () => {} },
      addEventListener: (type: string, fn: (ev?: Event) => void) => {
        if (type === "popstate") popstateListener = fn;
      },
      fetch: createFetchThatRecordsCalls(
        createJsonFragmentResponse({
          title: "Popstate Title",
          html: "<div>popstate content</div>",
        }),
      ),
    });

    await import("./nav-link-custom-element.ts");

    createNavLink();

    assertExists(popstateListener, "popstate listener should be registered");
    (popstateListener as (ev?: Event) => void)();

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(fetchCalls.length, 1);
    assertEquals(fetchCalls[0].url, popstateUrl);
    assertEquals(fetchCalls[0].headers["X-Requested-With"], "fetch");
    assertEquals(getMain()?.innerHTML ?? "", "<div>popstate content</div>");
    assertEquals(linkedomDocument.title, "Popstate Title");
  },
);

Deno.test(
  "NavLinkCustomElement - popstate shows error after 4 fragment load failures and does not reload",
  async () => {
    const popstateUrl = "http://localhost:8000/artists/a/albums/b";
    let popstateListener: ((ev?: Event) => void) | null = null;
    const reloadCalls: unknown[] = [];
    const storage: Record<string, string> = {};

    setupDOMEnvironment({
      location: {
        origin: "http://localhost:8000",
        get href() {
          return popstateUrl;
        },
        reload: () => reloadCalls.push(undefined),
      },
      history: { pushState: () => {} },
      addEventListener: (type: string, fn: (ev?: Event) => void) => {
        if (type === "popstate") popstateListener = fn;
      },
      sessionStorage: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => {
          storage[k] = v;
        },
        removeItem: (k: string) => delete storage[k],
        length: 0,
        key: () => null,
        clear: () => {},
      },
      fetch: () =>
        Promise.resolve({ ok: false, status: 503 }) as Promise<Response>,
    });

    const { _testResetPopstateState } = await import(
      "./nav-link-custom-element.ts"
    );
    _testResetPopstateState();

    createNavLink();

    assertExists(popstateListener, "popstate listener should be registered");

    for (let i = 0; i < 4; i++) {
      (popstateListener as (ev?: Event) => void)();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    }

    assertEquals(
      reloadCalls.length,
      0,
      "reload must not be called; error should be shown after 4 failures",
    );
    assertEquals(
      getMain()?.innerHTML.includes("Couldn't load this page") ?? false,
      true,
      "main should show error message after 4 failures",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - click fetches with X-Requested-With header and updates main and title",
  async () => {
    setupDOMEnvironment();

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(fetchCalls.length, 1);
    assertEquals(fetchCalls[0].url, "http://localhost:8000/");
    assertEquals(fetchCalls[0].headers["X-Requested-With"], "fetch");
    assertEquals(getMain()?.innerHTML ?? "", "<div>new content</div>");
    assertEquals(linkedomDocument.title, "New Title");
    assertEquals(pushStateCalls.length, 1);
    assertExists(pushStateCalls[0][2]);
    assertEquals(pushStateCalls[0][2] as string, "http://localhost:8000/");
  },
);

Deno.test(
  "NavLinkCustomElement - click with cross-origin href does not preventDefault and does not fetch",
  async () => {
    setupDOMEnvironment();

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "https://example.com/" });

    dispatchClick(el);

    assertEquals(
      preventDefaultCalled,
      false,
      "cross-origin link should not prevent default",
    );
    assertEquals(
      fetchCalls.length,
      0,
      "cross-origin link should not trigger fetch",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - click with metaKey (Cmd+click) does not preventDefault and does not fetch",
  async () => {
    setupDOMEnvironment();

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el, { metaKey: true });

    assertEquals(
      preventDefaultCalled,
      false,
      "Cmd+click should not prevent default (allows open in new tab)",
    );
    assertEquals(
      fetchCalls.length,
      0,
      "Cmd+click should not trigger fragment fetch",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - no href sets host tabindex -1 and no role",
  async () => {
    setupDOMEnvironment();

    await import("./nav-link-custom-element.ts");

    const el = createNavLink();

    assertEquals(
      el.getAttribute("tabindex"),
      "-1",
      "host should have tabindex -1 when no href",
    );
    assertEquals(
      el.getAttribute("role"),
      null,
      "host should have no role when no href",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - keydown Enter triggers same fetch as click",
  async () => {
    setupDOMEnvironment();

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchKeydown(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(fetchCalls.length, 1);
    assertEquals(fetchCalls[0].url, "http://localhost:8000/");
    assertEquals(fetchCalls[0].headers["X-Requested-With"], "fetch");
    assertEquals(preventDefaultCalled, true);
  },
);

Deno.test(
  "NavLinkCustomElement - keydown Enter with cross-origin href does not preventDefault and does not fetch",
  async () => {
    setupDOMEnvironment();

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "https://example.com/" });

    dispatchKeydown(el);

    assertEquals(
      preventDefaultCalled,
      false,
      "cross-origin keydown should not prevent default",
    );
    assertEquals(
      fetchCalls.length,
      0,
      "cross-origin keydown should not trigger fetch",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - fallback to location.href when fetch fails",
  async () => {
    let locationHrefSet = "";
    setupDOMEnvironment({
      location: {
        origin: "http://localhost:8000",
        get href() {
          return locationHrefSet || "http://localhost:8000/";
        },
        set href(value: string) {
          locationHrefSet = value;
        },
      },
      fetch: () =>
        Promise.resolve({ ok: false, status: 500 }) as Promise<Response>,
    });

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(locationHrefSet, "http://localhost:8000/");
  },
);

Deno.test(
  "NavLinkCustomElement - fallback to location.href when fragment response Content-Type is not application/json",
  async () => {
    let locationHrefSet = "";
    setupDOMEnvironment({
      location: {
        origin: "http://localhost:8000",
        get href() {
          return locationHrefSet || "http://localhost:8000/";
        },
        set href(value: string) {
          locationHrefSet = value;
        },
      },
      fetch: () =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ "Content-Type": "text/html" }),
          json: () =>
            Promise.resolve({
              title: "Untrusted",
              html: "<p>should not be applied</p>",
              meta: [],
            }),
        } as Response),
    });

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(
      getMain()?.innerHTML ?? "",
      "",
      "main must not be updated when Content-Type is not application/json",
    );
    assertEquals(locationHrefSet, "http://localhost:8000/");
  },
);

Deno.test(
  "NavLinkCustomElement - fragment with empty meta clears OG meta from head",
  async () => {
    setupDOMEnvironment();

    for (let i = 0; i < 2; i++) {
      const meta = linkedomDocument.createElement("meta");
      meta.setAttribute("property", `og:test${i}`);
      meta.setAttribute("content", "value");
      linkedomDocument.head.appendChild(meta);
    }

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const ogMeta = linkedomDocument.head.querySelectorAll(
      'meta[property^="og:"]',
    );
    assertEquals(
      ogMeta.length,
      0,
      "OG meta should be cleared when fragment has empty meta",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - fragment with new meta clears previous OG tags before applying",
  async () => {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          createJsonFragmentResponse({
            title: "Home",
            html: "<div>home content</div>",
            meta: [
              { property: "og:title", content: "BoomBox" },
              { property: "og:description", content: "Music player" },
            ],
          }),
        ),
    });

    for (let i = 0; i < 5; i++) {
      const meta = linkedomDocument.createElement("meta");
      meta.setAttribute("property", `og:old${i}`);
      meta.setAttribute("content", "old");
      linkedomDocument.head.appendChild(meta);
    }

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const ogMeta = linkedomDocument.head.querySelectorAll(
      'meta[property^="og:"]',
    );
    assertEquals(
      ogMeta.length,
      2,
      "should have exactly 2 OG meta tags after clearing 5 and applying 2",
    );
    assertEquals(
      linkedomDocument.querySelector('meta[property="og:title"]')?.getAttribute(
        "content",
      ),
      "BoomBox",
    );
    assertEquals(
      linkedomDocument.querySelector('meta[property="og:description"]')
        ?.getAttribute("content"),
      "Music player",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - fragment with styles injects critical CSS into head",
  async () => {
    const criticalCss = "<style>.album-page-main { flex: 1; }</style>";
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          createJsonFragmentResponse({
            title: "Album",
            html: "<div>album content</div>",
            meta: [],
            styles: criticalCss,
          }),
        ),
    });

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/artists/foo/albums/bar" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const styleEl = linkedomDocument.getElementById("fragment-critical-styles");
    assertExists(styleEl);
    assertEquals(styleEl.tagName.toLowerCase(), "style");
    assertEquals(
      (styleEl as HTMLStyleElement).textContent?.trim(),
      ".album-page-main { flex: 1; }",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - fragment with no styles removes existing critical-styles element",
  async () => {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          createJsonFragmentResponse({
            title: "Home",
            html: "<div>home</div>",
            meta: [],
            styles: undefined,
          }),
        ),
    });

    const existingStyle = linkedomDocument.createElement("style");
    existingStyle.id = "fragment-critical-styles";
    existingStyle.textContent = ".old { color: red; }";
    linkedomDocument.head.appendChild(existingStyle);

    await import("./nav-link-custom-element.ts");

    const el = createNavLink({ href: "/" });

    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const styleEl = linkedomDocument.getElementById("fragment-critical-styles");
    assertEquals(
      styleEl,
      null,
      "existing fragment-critical-styles element should be removed",
    );
  },
);

Deno.test(
  "NavLinkCustomElement - applyEnvelope applies libraryContents for info-client",
  async () => {
    const fragmentLibrary: Files = {
      NavArtist: {
        NavAlbum: {
          id: "NavArtist/NavAlbum",
          title: "NavAlbum",
          coverArtUrl: "https://example.com/from-fragment.jpg",
          tracks: [],
        },
      },
    };

    setupDOMEnvironment({
      fetch: createFetchThatRecordsCalls(
        createJsonFragmentResponse({ libraryContents: fragmentLibrary }),
      ),
    });

    const script = linkedomDocument.createElement("script");
    script.id = "boombox-library-contents";
    script.type = "application/json";
    script.textContent = "{}";
    linkedomDocument.body.appendChild(script);

    await import("./nav-link-custom-element.ts");
    const infoClient = await import("../../util/info-client.ts");
    infoClient.clearInfoClientCache();

    const el = createNavLink({ href: "/artists/a/b" });
    dispatchClick(el);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const url = await infoClient.getCoverArtUrlForAlbum(
      "NavArtist",
      "NavAlbum",
    );
    assertEquals(url, "https://example.com/from-fragment.jpg");
  },
);
