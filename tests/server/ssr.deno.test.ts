/** @file Tests for SSR rendering utilities */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  escapeAttr,
  isFragmentRequest,
  renderDocument,
  renderHead,
  renderLayout,
  renderPage,
} from "../../server/ssr.ts";
import type { Files } from "../../app/util/files.ts";

Deno.test("renderHead includes title, description, and asset links", () => {
  const html = renderHead({ title: "My Page" });
  assertStringIncludes(html, "<title>My Page</title>");
  assertStringIncludes(html, "Your audio where you want it.");
  assertStringIncludes(html, 'rel="stylesheet"');
  assertStringIncludes(html, "/app.css");
  assertStringIncludes(html, "/build/main.js");
});

Deno.test("renderDocument wraps head and body in full HTML document", () => {
  const html = renderDocument("<meta charset=utf-8>", "<div>body</div>");
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "<head>");
  assertStringIncludes(html, "<meta charset=utf-8>");
  assertStringIncludes(html, "<body>");
  assertStringIncludes(html, "<div>body</div>");
});

Deno.test("escapeAttr escapes HTML special characters", () => {
  assertEquals(escapeAttr('foo "bar"'), "foo &quot;bar&quot;");
  assertEquals(escapeAttr("<script>"), "&lt;script&gt;");
  assertEquals(escapeAttr("a & b"), "a &amp; b");
});

Deno.test("renderLayout includes playbar with data-album-url when provided", () => {
  const html = renderLayout({
    isAdmin: false,
    mainContentHtml: "<div>content</div>",
    playbarAlbumUrl: "https://bucket.s3.region.amazonaws.com/Artist/Album",
  });
  assertStringIncludes(html, "data-album-url=");
  assertStringIncludes(
    html,
    "https://bucket.s3.region.amazonaws.com/Artist/Album",
  );
});

Deno.test("isFragmentRequest returns true when X-Requested-With is fetch", () => {
  const req = new Request("http://localhost:8000/", {
    headers: { "X-Requested-With": "fetch" },
  });
  assertEquals(isFragmentRequest(req), true);
});

Deno.test("isFragmentRequest returns false when header is absent", () => {
  const req = new Request("http://localhost:8000/");
  assertEquals(isFragmentRequest(req), false);
});

Deno.test("isFragmentRequest returns false when header has other value", () => {
  const req = new Request("http://localhost:8000/", {
    headers: { "X-Requested-With": "xmlhttprequest" },
  });
  assertEquals(isFragmentRequest(req), false);
});

Deno.test("renderPage returns valid HTML", () => {
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    ["<div>content</div>"],
  );

  assertStringIncludes(html, "<!DOCTYPE html>", "Should start with DOCTYPE");
  assertStringIncludes(html, "<html", "Should contain html tag");
  assertStringIncludes(html, "<head>", "Should contain head");
  assertStringIncludes(html, "<body>", "Should contain body");
});

Deno.test("renderPage includes CSS and JS assets", () => {
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    [],
  );

  assertStringIncludes(
    html,
    'link rel="stylesheet"',
    "Should include CSS link",
  );
  assertStringIncludes(
    html,
    'script type="module"',
    "Should include JS script",
  );
  assertStringIncludes(html, "/app.css", "Should reference app CSS");
  assertStringIncludes(
    html,
    "/build/main.js",
    "Should reference main JS bundle",
  );
  assertStringIncludes(html, 'rel="preload"', "Should preload main script");
  assertStringIncludes(html, 'as="script"', "Should preload as script");
});

Deno.test("renderPage includes headLinks when provided", () => {
  const headLinks = [{ rel: "preconnect", href: "https://example.com" }];

  const html = renderPage(
    {
      appName: "Test App",
      headLinks,
      pathname: "/",
      isAdmin: false,
    },
    [],
  );

  assertStringIncludes(html, "preconnect", "Should include preconnect link");
  assertStringIncludes(html, "https://example.com", "Should include link href");
});

Deno.test("renderHead includes link as= when headLinks item sets as", () => {
  const html = renderHead({
    title: "P",
    headLinks: [
      { rel: "preload", href: "https://cdn.example.com/a.jpg", as: "image" },
    ],
  });
  assertStringIncludes(html, 'rel="preload"');
  assertStringIncludes(html, "https://cdn.example.com/a.jpg");
  assertStringIncludes(html, 'as="image"');
});

Deno.test("renderPage includes children in main", () => {
  const content = '<div class="album-row">Album content</div>';
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    [content],
  );

  assertStringIncludes(html, content, "Should include children in main");
  assertStringIncludes(html, "<main", "Should contain main element");
});

Deno.test("renderPage does not include app name header in layout", () => {
  /**
   * The header with the app name has been removed. The layout includes main
   * content and PlayBar, but no navbar with app name.
   */
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    [],
  );

  assertEquals(
    html.includes("text-xl font-bold"),
    false,
    "Should not include AppBar app name link",
  );
  assertEquals(
    html.includes('nav-link href="/"'),
    false,
    "Should not include app name nav link in body",
  );
});

Deno.test("renderPage includes upload dialog for admin requests", () => {
  /**
   * When isAdmin is true, the page must include the upload-dialog-custom-element
   * in the admin-toolbar container so the upload button is visible to admins.
   */
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: true,
    },
    ["<div>content</div>"],
  );

  assertStringIncludes(html, "admin-toolbar");
  assertStringIncludes(html, "refresh-cache-custom-element");
  assertStringIncludes(html, "upload-dialog-custom-element");
});

Deno.test("renderPage does not include upload button when not admin", () => {
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    ["<div>content</div>"],
  );

  assertEquals(
    html.includes("upload-dialog-custom-element"),
    false,
    "Should not include upload dialog when isAdmin is false",
  );
  assertEquals(
    html.includes("refresh-cache-custom-element"),
    false,
    "Should not include refresh cache when isAdmin is false",
  );
});

Deno.test("renderPage includes playbar-custom-element", () => {
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    [],
  );

  assertStringIncludes(html, "playbar-custom-element");
});

Deno.test("renderLayout embeds boombox-library-contents when libraryContents is set", () => {
  const libraryContents: Files = {
    A: {
      B: {
        id: "A/B",
        title: "B",
        coverArtUrl: null,
        tracks: [],
      },
    },
  };
  const html = renderLayout({
    isAdmin: false,
    mainContentHtml: "<div>x</div>",
    libraryContents,
  });
  assertStringIncludes(html, 'id="boombox-library-contents"');
  assertStringIncludes(html, "application/json");
  assertStringIncludes(html, '"A"');
});

Deno.test("renderPage includes track-click script", () => {
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
    },
    [],
  );

  assertStringIncludes(html, 'document.addEventListener("track-click"');
});

Deno.test("renderPage includes data-album-url on PlayBar when playbarAlbumUrl provided", () => {
  const albumUrl = "https://bucket.s3.region.amazonaws.com/artist/album";
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/artists/artist/albums/album",
      isAdmin: false,
      playbarAlbumUrl: albumUrl,
    },
    [],
  );

  assertStringIncludes(html, 'data-album-url="');
  assertStringIncludes(html, albumUrl);
});

Deno.test("renderPage includes headExtra in head when provided", () => {
  const headExtra =
    '<meta property="og:image" content="https://example.com/cover.jpg" />';
  const html = renderPage(
    {
      appName: "Test App",
      headLinks: [],
      pathname: "/",
      isAdmin: false,
      headExtra,
    },
    [],
  );

  assertStringIncludes(html, "og:image");
  assertStringIncludes(html, "https://example.com/cover.jpg");
});
