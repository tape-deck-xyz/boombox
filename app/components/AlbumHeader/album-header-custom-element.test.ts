/** @file Tests for AlbumHeaderCustomElement. */

import { assertEquals, assertExists } from "@std/assert";
import { createLinkedomEnv, wireLinkedomToGlobal } from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

let pendingAlbumHeaderAttrs: Record<string, string> | null = null;
let getAttributePatched = false;

function setupDOMEnvironment() {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    fetch: () => Promise.resolve(new Response(new Blob())),
  });
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser =
    (linkedomWindow as Window & { DOMParser: typeof DOMParser }).DOMParser;
  ensureGetAttributePatch();
}

function ensureGetAttributePatch() {
  if (getAttributePatched) return;
  getAttributePatched = true;
  const ElementProto = (linkedomWindow as Window & { Element: typeof Element })
    .Element?.prototype ?? (globalThis as { Element?: typeof Element }).Element
    ?.prototype;
  if (!ElementProto) return;
  const orig = ElementProto.getAttribute;
  ElementProto.getAttribute = function (this: Element, name: string) {
    if (pendingAlbumHeaderAttrs && name in pendingAlbumHeaderAttrs) {
      return pendingAlbumHeaderAttrs[name];
    }
    return orig.call(this, name);
  };
}

function createAlbumHeader(attrs: Record<string, string>): HTMLElement {
  pendingAlbumHeaderAttrs = attrs;
  try {
    const el = linkedomDocument.createElement("album-header-custom-element");
    for (const [name, value] of Object.entries(attrs)) {
      el.setAttribute(name, value);
    }
    return el as HTMLElement;
  } finally {
    pendingAlbumHeaderAttrs = null;
  }
}

Deno.test("AlbumHeaderCustomElement - renders album metadata as text", async () => {
  setupDOMEnvironment();
  await import("./album-header-custom-element.ts");

  const payload = '<img src=x onerror="alert(1)">';
  const el = createAlbumHeader({
    "data-album-url":
      `https://test-bucket.s3.test-region.amazonaws.com/${payload}/${payload}`,
    "data-cover-art-url": "https://example.test/cover.jpeg",
  });

  const title = el.shadowRoot?.querySelector(".album-title");
  const artist = el.shadowRoot?.querySelector(".album-artist");
  assertExists(title);
  assertExists(artist);
  assertEquals(title.textContent, payload);
  assertEquals(artist.textContent, payload);
  assertEquals(title.querySelector("img"), null);
  assertEquals(artist.querySelector("img"), null);
});
