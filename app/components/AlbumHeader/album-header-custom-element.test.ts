/** @file Tests for AlbumHeaderCustomElement lifecycle behavior. */

import { assertEquals, assertExists } from "@std/assert";
import {
  createLinkedomEnv,
  createS3ListXml,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

function setupDOMEnvironment() {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    fetch: () => Promise.resolve(new Response(createS3ListXml([]))),
    getComputedStyle: true,
  });

  (globalThis as { DOMParser: typeof DOMParser }).DOMParser =
    (linkedomWindow as Window & { DOMParser: typeof DOMParser }).DOMParser;

  (globalThis as { IntersectionObserver: typeof IntersectionObserver })
    .IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      root = null;
      rootMargin = "0px";
      thresholds = [];
    } as typeof IntersectionObserver;
}

Deno.test(
  "AlbumHeaderCustomElement - initializes attributes set after construction",
  async () => {
    setupDOMEnvironment();
    await import("./album-header-custom-element.ts");

    const el = linkedomDocument.createElement("album-header-custom-element");
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.us-east-1.amazonaws.com/Fragment Artist/Fragment Album",
    );
    linkedomDocument.body?.appendChild(el);

    assertExists(el.shadowRoot);
    assertEquals(
      el.shadowRoot?.querySelector(".album-title")?.textContent,
      "Fragment Album",
    );
    assertEquals(
      el.shadowRoot?.querySelector(".album-artist")?.textContent,
      "Fragment Artist",
    );
    assertEquals(
      el.shadowRoot
        ?.querySelector("album-image-custom-element")
        ?.getAttribute("data-album-url"),
      "https://bucket.s3.us-east-1.amazonaws.com/Fragment Artist/Fragment Album",
    );
  },
);
