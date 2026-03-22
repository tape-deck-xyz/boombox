/** @file Info endpoint - returns cached or fresh JSON (contents, timestamp, hostname) */
import { readInfoCache, regenerateInfoCache } from "../info.ts";
import { requireAdminAuth } from "../utils/basicAuth.ts";

/**
 * Handle GET `/info` — returns JSON with contents (files), timestamp, and hostname.
 *
 * - Without `?refresh=1`: serves from cache if available; otherwise fetches and caches
 * - With `?refresh=1`: requires admin Basic Auth; always fetches fresh data, updates
 *   cache, returns
 *
 * @param req - The incoming request
 * @param _params - Route params (unused)
 * @returns JSON response with Content-Type application/json
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
  }

  let payload;
  if (wantsRefresh) {
    payload = await regenerateInfoCache(req);
  } else {
    const cached = await readInfoCache();
    payload = cached ?? await regenerateInfoCache(req);
  }

  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}
