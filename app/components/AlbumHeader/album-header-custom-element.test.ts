/**
 * @file Tests for AlbumHeaderCustomElement.
 *
 * Covers safe rendering of album metadata derived from the album URL.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { createLinkedomEnv, wireLinkedomToGlobal } from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

let pendingAttrs: Record<string, string> | null = null;
let getAttributePatched = false;

function ensureGetAttributePatch() {
  if (getAttributePatched) return;
  getAttributePatched = true;
  const ElementProto = (linkedomWindow as Window & { Element: typeof Element })
    .Element?.prototype ?? (globalThis as { Element?: typeof Element }).Element
    ?.prototype;
  if (!ElementProto) return;
  const originalGetAttribute = ElementProto.getAttribute;
  ElementProto.getAttribute = function (this: Element, name: string) {
    if (pendingAttrs && name in pendingAttrs) {
      return pendingAttrs[name];
    }
    return originalGetAttribute.call(this, name);
  };
}

function setupDOMEnvironment() {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    fetch: () => new Promise<Response>(() => {}),
  });
  ensureGetAttributePatch();
}

function createAlbumHeader(attrs: Record<string, string>): HTMLElement {
  pendingAttrs = attrs;
  try {
    const el = linkedomDocument.createElement("album-header-custom-element");
    for (const [name, value] of Object.entries(attrs)) {
      el.setAttribute(name, value);
    }
    return el as HTMLElement;
  } finally {
    pendingAttrs = null;
  }
}

Deno.test("AlbumHeaderCustomElement - should render album URL parts markup as text", async () => {
  setupDOMEnvironment();
  await import("./album-header-custom-element.ts");

  const el = createAlbumHeader({
    "data-album-url":
      "https://cdn.example.test/<em data-owned=artist>Injected artist/<strong data-owned=album>Injected album",
    "data-cover-art-url": "https://cdn.example.test/cover.jpeg",
  });

  const title = el.shadowRoot?.querySelector(".album-title");
  const artist = el.shadowRoot?.querySelector(".album-artist");
  assertExists(title);
  assertExists(artist);
  assert(
    title.querySelector("strong") === null,
    "album title must not parse markup from metadata",
  );
  assert(
    artist.querySelector("em") === null,
    "album artist must not parse markup from metadata",
  );
  assertEquals(title.textContent, "<strong data-owned=album>Injected album");
  assertEquals(artist.textContent, "<em data-owned=artist>Injected artist");
});
