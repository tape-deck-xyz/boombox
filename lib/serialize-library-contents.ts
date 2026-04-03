/** @file Embed {@link Files} in HTML as JSON for the browser client (no GET /info). */

import type { Files } from "../app/util/files.ts";

/** `id` of the `<script type="application/json">` that holds library data in SSR layout. */
export const BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID = "boombox-library-contents";

/**
 * Serialize library contents for a `<script type="application/json">` block.
 * Escapes `<` so the payload cannot prematurely close the script element.
 */
export function serializeLibraryContentsForEmbeddedScript(
  files: Files,
): string {
  return JSON.stringify(files).replace(/</g, "\\u003c");
}
