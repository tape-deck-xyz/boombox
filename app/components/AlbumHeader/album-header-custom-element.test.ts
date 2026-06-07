/** @file Tests for AlbumHeaderCustomElement. */

import { assertEquals, assertExists } from "@std/assert";
import { createLinkedomEnv, wireLinkedomToGlobal } from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

let pendingAlbumHeaderAttrs: Record<string, string> | null = null;
let getAttributePatched = false;

function ensureGetAttributePatch(): void {
  if (getAttributePatched) return;
  getAttributePatched = true;
  const elementPrototype =
    (linkedomWindow as Window & { Element: typeof Element }).Element
      ?.prototype ?? (globalThis as { Element?: typeof Element }).Element
      ?.prototype;
  if (!elementPrototype) return;
  const originalGetAttribute = elementPrototype.getAttribute;
  elementPrototype.getAttribute = function (this: Element, name: string) {
    if (pendingAlbumHeaderAttrs && name in pendingAlbumHeaderAttrs) {
      return pendingAlbumHeaderAttrs[name];
    }
    return originalGetAttribute.call(this, name);
  };
}

function setupDOMEnvironment(): void {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, { event: true });
  ensureGetAttributePatch();
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser =
    linkedomWindow.DOMParser;
  (globalThis as { fetch: typeof fetch }).fetch = (() =>
    Promise.resolve(
      new Response("<ListBucketResult></ListBucketResult>"),
    )) as typeof fetch;
}

function createAlbumHeader(attrs: Record<string, string>): HTMLElement {
  pendingAlbumHeaderAttrs = attrs;
  try {
    const element = linkedomDocument.createElement(
      "album-header-custom-element",
    ) as HTMLElement;
    for (const [name, value] of Object.entries(attrs)) {
      element.setAttribute(name, value);
    }
    return element;
  } finally {
    pendingAlbumHeaderAttrs = null;
  }
}

Deno.test("AlbumHeaderCustomElement renders album URL path markup as text", async () => {
  setupDOMEnvironment();
  await import("./album-header-custom-element.ts");

  const maliciousAlbum = '<img src=x onerror="alert(1)">';
  const element = createAlbumHeader({
    "data-album-url":
      `https://bucket.s3.region.amazonaws.com/Artist/${maliciousAlbum}`,
  });

  const albumTitle = element.shadowRoot?.querySelector(".album-title");
  assertExists(albumTitle);
  assertEquals(albumTitle.textContent, maliciousAlbum);
  assertEquals(albumTitle.querySelector("img"), null);
});
