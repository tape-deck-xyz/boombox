/** @file Tests for embedded library catalog helpers (no GET /info). */
import { assertEquals } from "@std/assert";
import { createLinkedomEnv } from "../components/test.utils.ts";
import {
  clearInfoClientCache,
  fetchInfoContents,
  getCoverArtUrlForAlbum,
  setLibraryContentsFromServer,
} from "./info-client.ts";
import { BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID } from "../../lib/serialize-library-contents.ts";
import type { Files } from "./files.ts";

function useLinkedomDocument(): void {
  const { document: d } = createLinkedomEnv();
  (globalThis as { document: Document }).document = d;
}

function seedDomLibraryJson(files: Files): void {
  const existing = document.getElementById(BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID);
  existing?.remove();
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID;
  script.textContent = JSON.stringify(files);
  document.body.appendChild(script);
}

Deno.test("fetchInfoContents reads embedded script; getCoverArtUrlForAlbum reads coverArtUrl", async () => {
  useLinkedomDocument();
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
  seedDomLibraryJson(files);

  const c1 = await fetchInfoContents();
  const c2 = await fetchInfoContents();
  assertEquals(c1, files);
  assertEquals(c2, files);

  const url = await getCoverArtUrlForAlbum("Artist", "Album");
  assertEquals(url, "https://example.com/cover.jpeg");
});

Deno.test(
  "getCoverArtUrlForAlbum decodes artist/album segments to match contents keys (S3 URL-encoded paths)",
  async () => {
    useLinkedomDocument();
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
    seedDomLibraryJson(files);
    const url = await getCoverArtUrlForAlbum("Test%20Artist", "Test%20Album");
    assertEquals(url, cover);
  },
);

Deno.test("clearInfoClientCache drops in-memory-only override; updated DOM script remains", async () => {
  useLinkedomDocument();
  clearInfoClientCache();
  const filesA: Files = {
    A: {
      B: { id: "A/B", title: "B", coverArtUrl: null, tracks: [] },
    },
  };
  const filesB: Files = {
    X: {
      Y: {
        id: "X/Y",
        title: "Y",
        coverArtUrl: "https://u/c.jpg",
        tracks: [],
      },
    },
  };
  seedDomLibraryJson(filesA);
  setLibraryContentsFromServer(filesB);
  clearInfoClientCache();
  assertEquals(await fetchInfoContents(), filesB);
});
