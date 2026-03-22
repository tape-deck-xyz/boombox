/** @file Tests for album page route handler */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleAlbumHtml } from "../../../server/handlers/album.html.ts";
import { mockFilesWithAlbum, setupStorageEnv } from "./test-utils.ts";

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
