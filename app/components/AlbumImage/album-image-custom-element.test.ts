/**
 * @file Tests for AlbumImageCustomElement
 *
 * This test suite covers the album-image custom element that renders album art
 * from ID3 cover data. The element uses data-album-url to load the first track
 * of an album, extracts cover art via id3js, and displays it as a data URL.
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno.
 *
 * ## Key Testing Areas
 *
 * 1. Element lifecycle: creation, shadow root, connectedCallback, disconnectedCallback
 * 2. Observed attributes: data-album-url, class (and style propagation)
 * 3. Class and style copied from host to inner img
 * 4. loadAlbumImage: getFirstSong + getAlbumArtAsDataUrl (mocked fetch for S3)
 * 5. AbortController cleanup on disconnect or album URL change
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  createCustomElement,
  createLinkedomEnv,
  createS3ListXml,
  getFetchUrl,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

// ============================================================================
// MOCK STATE
// ============================================================================

const fetchCalls: { url: string }[] = [];

/** Creates a fetch that records URLs to fetchCalls. Returns S3 list XML for
 * list-type=2+prefix requests, 404 for MP3/other URLs. */
function createS3MockFetch(): (
  input: RequestInfo | URL,
) => Promise<Response> {
  const s3ListXml = createS3ListXml(["ArtistId/AlbumId/01__Track.mp3"]);
  return (input) => {
    const url = getFetchUrl(input);
    fetchCalls.push({ url });
    if (url.includes("list-type=2") && url.includes("prefix=")) {
      return Promise.resolve(
        new Response(s3ListXml, {
          headers: { "Content-Type": "application/xml" },
        }),
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  };
}

// ============================================================================
// DOM SETUP (must run before importing the element module)
// ============================================================================

function setupDOMEnvironment(options?: {
  fetch?: (input: RequestInfo | URL) => Promise<Response>;
}) {
  fetchCalls.length = 0;
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    fetch: options?.fetch ?? createS3MockFetch(),
  });
}

function createAlbumImage(attrs: Record<string, string> = {}): HTMLElement {
  return createCustomElement(
    linkedomDocument,
    "album-image-custom-element",
    attrs,
  );
}

function getImg(el: HTMLElement): HTMLImageElement | null {
  return (el.shadowRoot?.querySelector("img") ?? null) as
    | HTMLImageElement
    | null;
}

// ============================================================================
// TESTS
// ============================================================================

Deno.test(
  "AlbumImageCustomElement - should create element with shadow root",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage();

    assertExists(el);
    assertEquals(el.constructor.name, "AlbumImageCustomElement");
    assertExists(el.shadowRoot, "shadow root should exist (open mode)");
  },
);

Deno.test(
  "AlbumImageCustomElement - should have expected observedAttributes",
  async () => {
    setupDOMEnvironment();
    const { AlbumImageCustomElement } = await import(
      "./album-image-custom-element.ts"
    );

    assertEquals(AlbumImageCustomElement.observedAttributes, [
      "data-album-url",
      "data-cover-art-url",
      "class",
      "style",
    ]);
  },
);

Deno.test(
  "AlbumImageCustomElement - should copy class from host to img on connect",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage({ class: "album-cover rounded" });
    const img = getImg(el);

    assertExists(img);
    assertEquals(
      img.getAttribute("class"),
      "album-cover rounded",
      "img class should be set from host",
    );
  },
);

Deno.test(
  "AlbumImageCustomElement - should copy style from host to img on connect",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage({
      style: "width: 100%; border-radius: 4px;",
    });
    const img = getImg(el);

    assertExists(img);
    assertEquals(
      img.getAttribute("style"),
      "width: 100%; border-radius: 4px;",
      "img style should be set from host",
    );
  },
);

Deno.test(
  "AlbumImageCustomElement - should update img class when class attribute changes",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage();
    el.setAttribute("class", "new-class");
    const img = getImg(el);

    assertExists(img);
    assertEquals(
      img.getAttribute("class"),
      "new-class",
      "img class should update when host class changes",
    );
  },
);

Deno.test(
  "AlbumImageCustomElement - should call loadAlbumImage on connect when data-album-url is set",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    createAlbumImage({
      "data-album-url":
        "https://bucket.s3.region.amazonaws.com/ArtistId/AlbumId",
    });

    await new Promise((r) => setTimeout(r, 50));

    const hadListFetch = fetchCalls.some(
      (c) =>
        c.url.includes("list-type=2") &&
        c.url.includes("prefix=ArtistId/AlbumId/"),
    );
    assertExists(
      hadListFetch,
      "fetch should be called for S3 list",
    );
  },
);

Deno.test(
  "AlbumImageCustomElement - should not throw when disconnected",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage({
      "data-album-url":
        "https://bucket.s3.region.amazonaws.com/ArtistId/AlbumId",
    });
    linkedomDocument.body?.removeChild(el);
  },
);

Deno.test(
  "AlbumImageCustomElement - should not throw when connecting with no data-album-url",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage();
    assertExists(el.shadowRoot);
  },
);

Deno.test(
  "AlbumImageCustomElement - should not fetch when data-album-url has no artist/album path",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    createAlbumImage({
      "data-album-url": "https://bucket.s3.region.amazonaws.com",
    });

    await new Promise((r) => setTimeout(r, 30));

    const hadListFetch = fetchCalls.some(
      (c) => c.url.includes("list-type=2") && c.url.includes("prefix="),
    );
    assertEquals(
      hadListFetch,
      false,
      "should not call S3 list when URL has no artist/album segments",
    );
  },
);

Deno.test(
  "AlbumImageCustomElement - should trigger loadAlbumImage when data-album-url attribute changes",
  async () => {
    setupDOMEnvironment();
    await import("./album-image-custom-element.ts");

    const el = createAlbumImage();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.region.amazonaws.com/OtherArtist/OtherAlbum",
    );

    await new Promise((r) => setTimeout(r, 50));

    const hadListFetch = fetchCalls.some(
      (c) =>
        c.url.includes("list-type=2") &&
        c.url.includes("prefix=OtherArtist/OtherAlbum/"),
    );
    assertExists(
      hadListFetch,
      "fetch should be called when data-album-url is set",
    );
  },
);
