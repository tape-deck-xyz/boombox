/** @file Tests for RefreshCacheCustomElement
 *
 * Covers the refresh-cache custom element: trigger button, fetch on click,
 * reload on success, error display on failure.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  createCustomElement,
  createLinkedomEnv,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

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

  const trigger = getTrigger(el);
  assertExists(trigger);
  trigger.click();

  await Promise.resolve();
  await Promise.resolve();

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

  const trigger = getTrigger(el);
  assertExists(trigger);
  trigger.click();

  await Promise.resolve();
  await Promise.resolve();

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

    const trigger = getTrigger(el);
    assertExists(trigger);
    trigger.click();

    await Promise.resolve();
    await Promise.resolve();

    assertEquals(
      reloadCalled,
      false,
      "reload should not be called on fetch failure",
    );
  },
});
