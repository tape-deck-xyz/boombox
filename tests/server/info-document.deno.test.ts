/** @file Tests for info cache JSON Schema validation */
import { assertEquals, assertThrows } from "@std/assert";
import {
  assertValidInfoDocument,
  INFO_DOCUMENT_SCHEMA_VERSION,
  normalizeAlbumFromCache,
  normalizeContentsLegacy,
} from "../../server/info-document.ts";
import type { InfoPayload } from "../../server/info.ts";

Deno.test("assertValidInfoDocument accepts minimal valid document", () => {
  const payload: InfoPayload = {
    schemaVersion: INFO_DOCUMENT_SCHEMA_VERSION,
    timestamp: 1,
    hostname: "localhost",
    contents: {
      A: {
        B: {
          id: "A/B",
          title: "B",
          coverArtUrl: null,
          tracks: [
            {
              url: "https://x.s3.y.amazonaws.com/A/B/1__t.mp3",
              title: "t",
              trackNum: 1,
              lastModified: null,
            },
          ],
        },
      },
    },
  };
  assertValidInfoDocument(payload);
});

Deno.test("assertValidInfoDocument rejects missing schemaVersion", () => {
  assertThrows(
    () =>
      assertValidInfoDocument({
        timestamp: 1,
        hostname: "x",
        contents: {},
      }),
    Error,
    "Invalid info document",
  );
});

Deno.test("normalizeAlbumFromCache maps legacy coverArt string to coverArtUrl", () => {
  const album = normalizeAlbumFromCache({
    id: "A/B",
    title: "B",
    coverArt: "https://x/cover.jpeg",
    tracks: [],
  });
  assertEquals(album.coverArtUrl, "https://x/cover.jpeg");
});

Deno.test("normalizeContentsLegacy returns {} for non-object contents", () => {
  assertEquals(normalizeContentsLegacy(null), {});
  assertEquals(normalizeContentsLegacy("x"), {});
});

Deno.test("normalizeContentsLegacy skips non-object album buckets", () => {
  const out = normalizeContentsLegacy({
    Artist: null as unknown as Record<string, never>,
  });
  assertEquals(Object.keys(out), []);
});
