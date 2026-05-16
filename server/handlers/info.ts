/** @file Info endpoint - returns cached or fresh JSON (contents, timestamp, hostname)
 *
 * @see `docs/library-catalog-and-info.md`
 */
import {
  isAllowPublicInfoJson,
  isIfNoneMatchSatisfied,
  regenerateInfoCache,
  resolveInfoPayloadForGet,
  withRequestHostname,
} from "../info.ts";
import { getAdminAuthStatus, requireAdminAuth } from "../utils/basicAuth.ts";

async function strongEtagForBody(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Handle GET `/info` — returns JSON with contents (files), timestamp, and hostname.
 *
 * - Without `?refresh=1`: serves from cache / S3 / rebuild; respects
 *   `ALLOW_PUBLIC_INFO_JSON` (when `false`, requires admin Basic Auth)
 * - With `?refresh=1`: requires admin Basic Auth; rebuilds from listing,
 *   updates S3 `info.json` and disk cache
 *
 * @param req - The incoming request
 * @param _params - Route params (unused)
 * @returns JSON with `Content-Type: application/json; charset=utf-8`, or **304**
 * when `If-None-Match` matches the current ETag
 */
export async function handleInfo(
  req: Request,
  _params: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const wantsRefresh = url.searchParams.get("refresh") === "1";

  if (wantsRefresh) {
    const authError = requireAdminAuth(req);
    if (authError) return authError;
  } else {
    const { isAdmin } = getAdminAuthStatus(req);
    if (!isAllowPublicInfoJson() && !isAdmin) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload;
  if (wantsRefresh) {
    payload = await regenerateInfoCache(req);
  } else {
    const resolved = await resolveInfoPayloadForGet(req);
    payload = resolved.payload;
  }

  const cacheControl = isAllowPublicInfoJson()
    ? "public, max-age=60"
    : "private, max-age=0, must-revalidate";
  const body = JSON.stringify(withRequestHostname(payload, req));
  const etagForHttp = await strongEtagForBody(body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    ETag: `"${etagForHttp}"`,
  };

  if (
    isIfNoneMatchSatisfied(req.headers.get("If-None-Match"), etagForHttp)
  ) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, { headers });
}
