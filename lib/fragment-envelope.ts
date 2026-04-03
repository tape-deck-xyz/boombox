/** @file Shared fragment envelope types and request constants.
 *
 * Single source of truth for the client-server fragment protocol. The client
 * sends X-Requested-With: fetch; the server responds with a JSON envelope.
 * Used by server/ssr.ts and app/components/NavLink/nav-link-custom-element.ts.
 *
 * @see `docs/library-catalog-and-info.md` — library catalog, `/info`, fragments.
 */

import type { Files } from "../app/util/files.ts";

/** Request header used to request a fragment (main content + title + meta) instead of full page. */
export const FRAGMENT_REQUEST_HEADER = "X-Requested-With";

/** Value for {@link FRAGMENT_REQUEST_HEADER} when client wants fragment JSON. */
export const FRAGMENT_REQUEST_VALUE = "fetch";

/** One meta tag for the fragment JSON envelope (OG or other head meta). */
export interface FragmentMetaItem {
  /** e.g. "og:title" */
  property?: string;
  /** e.g. "description" */
  name?: string;
  /** Meta content value. */
  content: string;
}

/** JSON envelope returned for fragment requests: title, main HTML, optional meta and critical CSS. */
export interface FragmentEnvelope {
  title: string;
  html: string;
  meta?: FragmentMetaItem[];
  /**
   * Optional critical CSS for the page. Typically a single <style>...</style> block or raw CSS.
   * The client expects at most one outer <style> wrapper to strip; multiple blocks are undefined.
   */
  styles?: string;
  /**
   * Library tree for client-side cover/metadata (`info-client`). Omits a separate `GET /info`
   * fetch on fragment navigation when present.
   */
  libraryContents?: Files;
}
