/** @file Tests for /info client cache helpers */
import { assertEquals } from "@std/assert";
import {
  clearInfoClientCache,
  fetchInfoContents,
  getCoverArtUrlForAlbum,
} from "./info-client.ts";
import type { Files } from "./files.ts";

Deno.test("fetchInfoContents caches JSON contents and getCoverArtUrlForAlbum reads coverArtUrl", async () => {
  clearInfoClientCache();
  const files: Files = {
    Artist: {
      Album: {
        id: "Artist/Album",
        title: "Album",
        coverArtUrl: "https://example.com/cover.jpeg",
        tracks: [],
      },
    },
  };

  const fetchCalls: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify({ contents: files, schemaVersion: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    const c1 = await fetchInfoContents();
    const c2 = await fetchInfoContents();
    assertEquals(fetchCalls.length, 1);
    assertEquals(c1, files);
    assertEquals(c2, files);

    const url = await getCoverArtUrlForAlbum("Artist", "Album");
    assertEquals(url, "https://example.com/cover.jpeg");
    assertEquals(fetchCalls.length, 1);
  } finally {
    globalThis.fetch = origFetch;
    clearInfoClientCache();
  }
});

Deno.test(
  "getCoverArtUrlForAlbum decodes artist/album segments to match /info keys (S3 URL-encoded paths)",
  async () => {
    clearInfoClientCache();
    const cover =
      "https://bucket.s3.us-east-1.amazonaws.com/Test%20Artist/Test%20Album/cover.jpeg";
    const files: Files = {
      "Test Artist": {
        "Test Album": {
          id: "Test Artist/Test Album",
          title: "Test Album",
          coverArtUrl: cover,
          tracks: [],
        },
      },
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ contents: files, schemaVersion: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;
    try {
      const url = await getCoverArtUrlForAlbum("Test%20Artist", "Test%20Album");
      assertEquals(url, cover);
    } finally {
      globalThis.fetch = origFetch;
      clearInfoClientCache();
    }
  },
);

Deno.test("clearInfoClientCache forces next fetchInfoContents to refetch", async () => {
  clearInfoClientCache();
  let n = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    n++;
    return Promise.resolve(
      new Response(JSON.stringify({ contents: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await fetchInfoContents();
    await fetchInfoContents();
    assertEquals(n, 1);
    clearInfoClientCache();
    await fetchInfoContents();
    assertEquals(n, 2);
  } finally {
    globalThis.fetch = origFetch;
    clearInfoClientCache();
  }
});
