/** @file Index page route handler */
import { isFragmentRequest, renderPage } from "../ssr.ts";
import { getUploadedFiles } from "../../app/util/s3.server.ts";
import { getAdminAuthStatus, requireAdminAuth } from "../utils/basicAuth.ts";

import blankSlateHtml from "../../app/components/BlankSlate/blank-slate-html.ts";
import albumRowWithTitleHtml from "../../app/components/AlbumRow/album-row-with-title-html.ts";
import { getAlbumIdsByRecent } from "../../app/util/files.ts";
import pkg from "../../deno.json" with { type: "json" };

/**
 * Handles GET `/` (home) and GET `/admin` (admin login entry).
 *
 * **Admin auth flow:**
 * - GET `/admin`: Requires valid Basic Auth. If missing or invalid, returns 401
 *   with `WWW-Authenticate: Basic` (browser shows login dialog). After success,
 *   redirects to `/` so the same request is sent with the `Authorization`
 *   header; the home page then renders with admin UI (e.g. upload).
 * - GET `/`: No challenge. Uses `getAdminAuthStatus(req)` to set `isAdmin` for
 *   SSR; when true, the page shows admin-only UI (upload dialog, etc.).
 *
 * @param req - The incoming request
 * @param _params - Route params (unused for index)
 * @returns HTML response for the home page, or 401/302 for `/admin`
 */
export async function handleIndexHtml(
  req: Request,
  _params: Record<string, string>,
): Promise<Response> {
  const pathname = new URL(req.url).pathname;

  /**
   * GET `/admin`: Enforce Basic Auth, then redirect to home.
   * On missing/invalid credentials, returns 401 with WWW-Authenticate (browser
   * shows login). On success, redirects to `/` so the home request carries
   * the Authorization header and SSR can set isAdmin for admin UI.
   */
  if (pathname === "/admin") {
    const authError = requireAdminAuth(req);
    if (authError) {
      return authError;
    }

    const redirectUrl = new URL("/", req.url).toString();
    return Response.redirect(redirectUrl, 302);
  }

  const files = await getUploadedFiles();
  const recentlyUploadedAlbumIds = getAlbumIdsByRecent(files).slice(0, 5);
  const { isAdmin } = getAdminAuthStatus(req);
  // const recentlyListenedToAlbumIds = [
  //   { id: "Childish Gambino/Poindexter" },
  //   { id: "Girl Talk/All Day" },
  //   { id: "Pearl Jam/Vitalogy (Expanded Edition)" },
  //   { id: "The Rolling Stones/Let It Bleed" },
  //   { id: "The Black Keys/Ohio Players" },
  // ];

  // const mostListenedToAlbumIds = [
  //   { id: "Pearl Jam/Dark Matter" },
  //   { id: "Run The Jewels/RTJ4" },
  //   { id: "Pink Floyd/Wish You Were Here" },
  //   { id: "Wu-Tang Clan/Enter The Wu-Tang: 36 Chambers" },
  //   { id: "The Rolling Stones/Exile On Main St." },
  // ];

  const mainContentHtml = recentlyUploadedAlbumIds.length === 0
    ? blankSlateHtml({ isAdmin })
    : albumRowWithTitleHtml({
      albumIds: recentlyUploadedAlbumIds,
      files: files,
      title: "Latest",
    });

  if (isFragmentRequest(req)) {
    const envelope = {
      title: pkg.name,
      html: mainContentHtml,
      meta: [] as Array<{ property?: string; name?: string; content: string }>,
      libraryContents: files,
    };
    return new Response(JSON.stringify(envelope), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const html = renderPage(
    {
      appName: pkg.name,
      headLinks: [],
      pathname,
      isAdmin,
      libraryContents: files,
    },
    [mainContentHtml],
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}
