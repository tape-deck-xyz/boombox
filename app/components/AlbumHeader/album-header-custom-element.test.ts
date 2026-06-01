/** @file Tests for AlbumHeaderCustomElement. */

import { assertEquals, assertExists } from "@std/assert";
import {
  createLinkedomEnv,
  createS3ListXml,
  getFetchUrl,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

let pendingAttrs: Record<string, string> | null = null;
let getAttributePatched = false;

function setupDOMEnvironment(): void {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    fetch: (input) => {
      const url = getFetchUrl(input);
      if (url.includes("list-type=2") && url.includes("prefix=")) {
        return Promise.resolve(new Response(createS3ListXml([])));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    },
  });
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser =
    (linkedomWindow as Window & { DOMParser: typeof DOMParser }).DOMParser;
  ensureGetAttributePatch();
}

function ensureGetAttributePatch(): void {
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

function createAlbumHeader(attrs: Record<string, string>): HTMLElement {
  pendingAttrs = attrs;
  try {
    const el = linkedomDocument.createElement("album-header-custom-element");
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    return el as HTMLElement;
  } finally {
    pendingAttrs = null;
  }
}

Deno.test(
  "AlbumHeaderCustomElement renders album and artist names as text",
  async () => {
    setupDOMEnvironment();
    await import("./album-header-custom-element.ts");

    const maliciousAlbum = `<img src=x onerror="globalThis.__albumXss = true">`;
    const maliciousArtist =
      `<img src=x onerror="globalThis.__artistXss = true">`;
    const el = createAlbumHeader({
      "data-album-url":
        `https://bucket.s3.region.amazonaws.com/${maliciousArtist}/${maliciousAlbum}`,
    });

    assertExists(el.shadowRoot);
    const title = el.shadowRoot.querySelector(".album-title");
    const artist = el.shadowRoot.querySelector(".album-artist");

    assertEquals(title?.textContent, maliciousAlbum);
    assertEquals(artist?.textContent, maliciousArtist);
    assertEquals(title?.querySelector("img"), null);
    assertEquals(artist?.querySelector("img"), null);
  },
);
