/** @file Tests for album page route handler */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { getUploadedFiles } from "../../../app/util/s3.server.ts";
import { handleAlbumHtml } from "../../../server/handlers/album.html.ts";
import { mockFilesWithAlbum, setupStorageEnv } from "./test-utils.ts";
import { setSendBehavior } from "../s3.server.test-mocks/s3-client.ts";

Deno.test("Album handler returns 400 when artistId is missing", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  const req = new Request(
    "http://localhost:8000/artists//albums/SomeAlbum",
  );
  const response = await handleAlbumHtml(req, {
    artistId: "",
    albumId: "SomeAlbum",
  });
  assertEquals(response.status, 400);
  const text = await response.text();
  assertEquals(text, "Missing artist or album ID");
});

Deno.test("Album handler returns full HTML when no fragment header", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  const req = new Request(
    "http://localhost:8000/artists/Test%20Artist/albums/Test%20Album",
  );
  const response = await handleAlbumHtml(req, {
    artistId: "Test Artist",
    albumId: "Test Album",
  });

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "text/html");
  const html = await response.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "tracklist");
  assertStringIncludes(html, "album-header-custom-element");
});

Deno.test("Album handler returns JSON fragment when X-Requested-With fetch", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  const req = new Request(
    "http://localhost:8000/artists/Test%20Artist/albums/Test%20Album",
    { headers: { "X-Requested-With": "fetch" } },
  );
  const response = await handleAlbumHtml(req, {
    artistId: "Test Artist",
    albumId: "Test Album",
  });

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/json",
  );
  const body = await response.json();
  assertEquals(typeof body.title, "string");
  assertStringIncludes(body.title, "Test Album");
  assertEquals(typeof body.html, "string");
  assertEquals(body.html.includes("<!DOCTYPE html"), false);
  assertStringIncludes(body.html, "tracklist");
  assertStringIncludes(body.html, "album-header-custom-element");
  assertEquals(Array.isArray(body.meta), true);
  const ogTitle = body.meta?.find(
    (m: { property?: string }) => m.property === "og:title",
  );
  assertEquals(ogTitle != null, true);
  assertEquals(ogTitle.content.includes("Test Album"), true);
  assertEquals(typeof body.styles, "string");
  assertStringIncludes(body.styles, "album-header-custom-element");
  assertStringIncludes(body.styles, ".album-page-main");
});

Deno.test("Album full HTML preloads coverArtUrl and sets data-cover-art-url", async () => {
  setupStorageEnv();
  const now = new Date();
  try {
    setSendBehavior((command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        ?.name;
      if (name === "ListObjectsV2Command") {
        return Promise.resolve({
          Contents: [
            {
              Key: "Test%20Artist/Test%20Album/1__Test%20Track.mp3",
              LastModified: now,
            },
            {
              Key: "Test%20Artist/Test%20Album/cover.jpeg",
              LastModified: now,
            },
          ],
          IsTruncated: false,
        });
      }
      return Promise.resolve({});
    });
    await getUploadedFiles(true);

    const req = new Request(
      "http://localhost:8000/artists/Test%20Artist/albums/Test%20Album",
    );
    const response = await handleAlbumHtml(req, {
      artistId: "Test Artist",
      albumId: "Test Album",
    });

    assertEquals(response.status, 200);
    const html = await response.text();
    const expectedCover =
      "https://test-bucket.s3.test-region.amazonaws.com/Test%20Artist/Test%20Album/cover.jpeg";
    assertStringIncludes(html, 'rel="preload"');
    assertStringIncludes(html, expectedCover);
    assertStringIncludes(html, 'as="image"');
    assertStringIncludes(html, "data-cover-art-url");
  } finally {
    setSendBehavior(null);
    await getUploadedFiles(true);
  }
});
