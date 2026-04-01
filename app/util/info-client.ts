/** @file Client-side library catalog from SSR embed (first-party UI must not HTTP GET /info for catalog data).
 *
 * @see `docs/library-catalog-and-info.md`
 */
import type { Files } from "./files.ts";
import {
  BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID,
  serializeLibraryContentsForEmbeddedScript,
} from "../../lib/serialize-library-contents.ts";

/**
 * Normalizes a path segment from a track URL so it matches {@link Files} keys
 * (decoded artist/album names, same as `listObjects` in `s3.server.ts`).
 */
function segmentAsInfoLookupKey(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** `undefined` = read from DOM; otherwise in-memory view (also synced to DOM when possible). */
let memoryOverride: Files | null | undefined = undefined;

function readLibraryContentsFromDom(): Files | null {
  if (globalThis.document === undefined) return null;
  const el = document.getElementById(BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID);
  if (!el?.textContent?.trim()) return null;
  try {
    return JSON.parse(el.textContent) as Files;
  } catch {
    return null;
  }
}

function getLibraryContents(): Files | null {
  if (memoryOverride !== undefined) return memoryOverride;
  return readLibraryContentsFromDom();
}

/** Resets the in-memory override so the next read uses the embedded script again. */
export function clearInfoClientCache(): void {
  memoryOverride = undefined;
}

/**
 * Apply server-provided library data (fragment navigation or tests). Updates the
 * `<script type="application/json">` node when present.
 */
export function setLibraryContentsFromServer(contents: Files): void {
  memoryOverride = contents;
  if (globalThis.document === undefined) return;
  let el = document.getElementById(BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID);
  const serialized = serializeLibraryContentsForEmbeddedScript(contents);
  if (el) {
    el.textContent = serialized;
  } else {
    el = document.createElement("script");
    el.type = "application/json";
    el.id = BOOMBOX_LIBRARY_CONTENTS_SCRIPT_ID;
    el.textContent = serialized;
    document.body.appendChild(el);
  }
}

/**
 * Returns embedded `Files` from the page (or the last {@link setLibraryContentsFromServer} value).
 */
export function fetchInfoContents(): Promise<Files | null> {
  return Promise.resolve(getLibraryContents());
}

/**
 * `coverArtUrl` for an album from the embedded catalog, or `null`.
 *
 * `artistId` and `albumId` may be raw path segments from a track URL (including
 * percent-encoding); they are decoded before lookup so they match `contents` keys.
 */
export async function getCoverArtUrlForAlbum(
  artistId: string,
  albumId: string,
): Promise<string | null> {
  const contents = await fetchInfoContents();
  if (!contents) return null;
  const artistKey = segmentAsInfoLookupKey(artistId);
  const albumKey = segmentAsInfoLookupKey(albumId);
  const albumEntry = contents[artistKey]?.[albumKey];
  if (!albumEntry) return null;
  return albumEntry.coverArtUrl;
}
