/** @file Tests for RefreshCacheCustomElement
 *
 * Covers the refresh-cache custom element: trigger button, fetch on click,
 * reload on success, error display on failure.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  createCustomElement,
  createLinkedomEnv,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

// ============ LINKEDOM SETUP ============

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

// ============ MOCK STATE / TEST HELPERS ============

function setupDOMEnvironment(options?: {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  location?: { reload: () => void };
}) {
  const locationMock = {
    origin: "http://localhost:8000",
    reload: options?.location?.reload ?? (() => {}),
  };
  (globalThis as { location: Location }).location =
    locationMock as unknown as Location;

  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    event: true,
    fetch: options?.fetch ??
      (() => Promise.resolve(new Response("{}", { status: 200 }))),
  });
}

function createRefreshCache(attrs: Record<string, string> = {}): HTMLElement {
  return createCustomElement(
    linkedomDocument,
    "refresh-cache-custom-element",
    attrs,
  );
}

function getTrigger(el: HTMLElement): HTMLButtonElement | null {
  return el.shadowRoot?.getElementById("trigger") as HTMLButtonElement | null;
}

/** Drains microtasks so async fetch handler and finally block run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function clickRefreshAndFlush(el: HTMLElement): Promise<void> {
  getTrigger(el)?.click();
  await flushMicrotasks();
}

// ============ TESTS ============

Deno.test("RefreshCacheCustomElement - renders button with aria-label", async () => {
  setupDOMEnvironment();
  await import("./refresh-cache-custom-element.ts");

  const el = createRefreshCache();
  linkedomDocument.body.appendChild(el);

  const trigger = getTrigger(el);
  assertExists(trigger, "trigger button should exist");
  assertEquals(trigger.getAttribute("aria-label"), "Refresh library");
  assertEquals(trigger.getAttribute("title"), "Refresh library");
});

Deno.test("RefreshCacheCustomElement - click triggers fetch to /info?refresh=1 with credentials", async () => {
  let fetchUrl: string | null = null;
  let fetchCredentials: RequestCredentials | undefined;

  setupDOMEnvironment({
    fetch: (input, init) => {
      fetchUrl = typeof input === "string" ? input : input.toString();
      fetchCredentials = init?.credentials;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  await import("./refresh-cache-custom-element.ts");

  const el = createRefreshCache();
  linkedomDocument.body.appendChild(el);

  assertExists(getTrigger(el));
  await clickRefreshAndFlush(el);

  assertExists(fetchUrl, "fetch should have been called");
  assertEquals(fetchUrl, "http://localhost:8000/info?refresh=1");
  assertEquals(fetchCredentials, "include");
});

Deno.test("RefreshCacheCustomElement - calls location.reload on fetch success", async () => {
  let reloadCalled = false;

  setupDOMEnvironment({
    fetch: () => Promise.resolve(new Response("{}", { status: 200 })),
    location: {
      reload: () => {
        reloadCalled = true;
      },
    },
  });
  await import("./refresh-cache-custom-element.ts");

  const el = createRefreshCache();
  linkedomDocument.body.appendChild(el);

  assertExists(getTrigger(el));
  await clickRefreshAndFlush(el);

  assertEquals(reloadCalled, true);
});

Deno.test({
  name: "RefreshCacheCustomElement - does not reload on fetch failure",
  sanitizeOps: false,
  sanitizeResources: false, // Component uses setTimeout for error dismissal
  async fn() {
    let reloadCalled = false;

    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          new Response("Server error", { status: 500 }),
        ),
      location: {
        reload: () => {
          reloadCalled = true;
        },
      },
    });
    await import("./refresh-cache-custom-element.ts");

    const el = createRefreshCache();
    linkedomDocument.body.appendChild(el);

    assertExists(getTrigger(el));
    await clickRefreshAndFlush(el);

    assertEquals(
      reloadCalled,
      false,
      "reload should not be called on fetch failure",
    );
  },
});

Deno.test({
  name: "RefreshCacheCustomElement - shows login message on 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          new Response("Unauthorized", { status: 401 }),
        ),
    });
    await import("./refresh-cache-custom-element.ts");

    const el = createRefreshCache();
    linkedomDocument.body.appendChild(el);

    await clickRefreshAndFlush(el);

    const errorEl = el.shadowRoot?.querySelector(".error-message");
    assertExists(errorEl, "error message should be visible");
    assertStringIncludes(
      errorEl.textContent ?? "",
      "Please log in to refresh the library.",
    );
    assertEquals(errorEl.getAttribute("role"), "alert");
  },
});

Deno.test({
  name: "RefreshCacheCustomElement - shows error message on non-ok response",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          new Response("Server error", { status: 500 }),
        ),
    });
    await import("./refresh-cache-custom-element.ts");

    const el = createRefreshCache();
    linkedomDocument.body.appendChild(el);

    await clickRefreshAndFlush(el);

    const errorEl = el.shadowRoot?.querySelector(".error-message");
    assertExists(errorEl, "error message should be visible");
    assertStringIncludes(errorEl.textContent ?? "", "Refresh failed:");
    assertStringIncludes(errorEl.textContent ?? "", "500");
  },
});

Deno.test({
  name: "RefreshCacheCustomElement - shows error on fetch rejection",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    let reloadCalled = false;

    setupDOMEnvironment({
      fetch: () => Promise.reject(new Error("Network failure")),
      location: {
        reload: () => {
          reloadCalled = true;
        },
      },
    });
    await import("./refresh-cache-custom-element.ts");

    const el = createRefreshCache();
    linkedomDocument.body.appendChild(el);

    await clickRefreshAndFlush(el);

    assertEquals(reloadCalled, false, "reload should not be called on reject");
    const errorEl = el.shadowRoot?.querySelector(".error-message");
    assertExists(errorEl, "error message should be visible");
    assertStringIncludes(errorEl.textContent ?? "", "Network failure");
  },
});

Deno.test("RefreshCacheCustomElement - disables button and adds loading class during fetch", async () => {
  let resolveFetch!: (value: Response) => void;
  const fetchPromise = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });

  setupDOMEnvironment({
    fetch: () => fetchPromise,
  });
  await import("./refresh-cache-custom-element.ts");

  const el = createRefreshCache();
  linkedomDocument.body.appendChild(el);

  getTrigger(el)?.click();
  await flushMicrotasks();

  const trigger = getTrigger(el);
  assertExists(trigger);
  assertEquals(trigger.disabled, true, "button should be disabled during fetch");
  assertEquals(
    trigger.classList.contains("loading"),
    true,
    "button should have loading class during fetch",
  );

  resolveFetch(new Response("{}", { status: 200 }));
  await flushMicrotasks();
});

Deno.test({
  name: "RefreshCacheCustomElement - button re-enables after fetch failure",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          new Response("Server error", { status: 500 }),
        ),
    });
    await import("./refresh-cache-custom-element.ts");

    const el = createRefreshCache();
    linkedomDocument.body.appendChild(el);

    await clickRefreshAndFlush(el);

    const trigger = getTrigger(el);
    assertExists(trigger);
    assertEquals(
      trigger.disabled,
      false,
      "button should be re-enabled after failure",
    );
  },
});
