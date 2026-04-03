/**
 * Main Deno server entry point.
 *
 * Serves the remix-audio app: static assets, CSS, favicon, and API routes.
 * Request handling order: static files under `/build/` and `/assets/`, favicon,
 * `/app.css`, then the router (HTML pages and upload/album endpoints).
 *
 * @module
 */
import { Router } from "./router.ts";
import { handleUpload } from "./handlers/upload.ts";
import { handleIndexHtml } from "./handlers/index.html.ts";
import { loadEnv } from "./utils/loadEnv.ts";
import {
  logStartupConfigIssuesAndExit,
  validateStartupConfig,
} from "./utils/validateStartupConfig.ts";
import { handleAlbumCover } from "./handlers/album.cover.ts";
import { handleAlbumHtml } from "./handlers/album.html.ts";
import { handleInfo } from "./handlers/info.ts";
import { ensureInfoJsonSeededAtStartup } from "./info.ts";
import { createLogger } from "../app/util/logger.ts";

// Create logger instance for server
const logger = createLogger("Server");

// --- Environment & router setup ---
await loadEnv();
const validation = validateStartupConfig();
if (!validation.ok) {
  logStartupConfigIssuesAndExit(validation);
}
if (validation.adminDisabled) {
  logger.info(
    "Admin panel disabled (ADMIN_USER and ADMIN_PASS not set). Protected routes will return 500.",
  );
}

try {
  await ensureInfoJsonSeededAtStartup();
} catch (e) {
  logger.warn("ensureInfoJsonSeededAtStartup failed", { error: String(e) });
}

const router = new Router();

// App routes (HTML)
router.add({ pattern: "/", handler: handleIndexHtml, method: "GET" });
router.add({ pattern: "/admin", handler: handleIndexHtml, method: "GET" });
router.add({ pattern: "/info", handler: handleInfo, method: "GET" });
router.add({ pattern: "/", handler: handleUpload, method: "POST" });
router.add({
  pattern: "/artists/:artistId/albums/:albumId/cover",
  handler: handleAlbumCover,
  method: "GET",
});
router.add({
  pattern: "/artists/:artistId/albums/:albumId",
  handler: handleAlbumHtml,
  method: "GET",
});

/**
 * CORS headers applied to `/build/*` and `/app.css` responses so those
 * assets can be loaded cross-origin (e.g. from another origin or dev tools).
 */
// const CORS_HEADERS: Record<string, string> = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Methods": "GET, OPTIONS",
//   "Access-Control-Allow-Headers": "Content-Type",
//   "Access-Control-Max-Age": "86400",
// };

// --- Server ---
const port = parseInt(Deno.env.get("PORT") || "8000", 10);
console.log(`🔊 BoomBox server running on http://localhost:${port}`);

Deno.serve({ port }, async (req: Request) => {
  const url = new URL(req.url);
  logger.debug("Request URL", { url: url.toString() });

  // Static assets from build directory (CORS enabled)
  if (url.pathname.startsWith("/build/")) {
    try {
      const filePath = `.${url.pathname}`;
      const file = await Deno.readFile(filePath);
      const contentType = getContentType(url.pathname);
      return new Response(file, {
        headers: { "Content-Type": contentType },
      });
    } catch (error) {
      logger.error(`Failed to serve static file ${url.pathname}:`, error);
      return new Response("Not Found", {
        status: 404,
      });
    }
  }

  // Vite-style assets under /assets/ (build/client/assets/)
  if (url.pathname.startsWith("/assets/")) {
    try {
      const filePath = `./build/client${url.pathname}`;
      const file = await Deno.readFile(filePath);
      const contentType = getContentType(url.pathname);
      return new Response(file, {
        headers: { "Content-Type": contentType },
      });
    } catch (error) {
      logger.error(`Failed to serve static file ${url.pathname}:`, error);
      return new Response("Not Found", {
        status: 404,
      });
    }
  }

  // Favicon from public/
  if (url.pathname === "/favicon.ico") {
    try {
      const file = await Deno.readFile("./public/favicon.ico");
      return new Response(file, {
        headers: { "Content-Type": "image/x-icon" },
      });
    } catch (error) {
      logger.error(`Failed to serve static file ${url.pathname}:`, error);
      return new Response("Not Found", {
        status: 404,
      });
    }
  }

  // Global app stylesheet (CORS enabled)
  if (url.pathname === "/app.css") {
    try {
      const file = await Deno.readFile("./app/app.css");
      return new Response(file, {
        headers: { "Content-Type": "text/css" },
      });
    } catch (error) {
      logger.error(`Failed to serve static file ${url.pathname}:`, error);
      return new Response("Not Found", {
        status: 404,
      });
    }
  }

  // HTML pages and API (upload, album cover, album page)
  return router.handle(req);
});

/**
 * Derives a `Content-Type` value from a URL pathname for static file responses.
 *
 * @param pathname - Request path (e.g. `/build/client/main.js`)
 * @returns MIME type string, or `application/octet-stream` if unknown
 */
function getContentType(pathname: string): string {
  if (pathname.endsWith(".css")) return "text/css";
  if (pathname.endsWith(".js")) return "application/javascript";
  if (pathname.endsWith(".json")) return "application/json";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
