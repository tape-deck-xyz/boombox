/** @file Client fetch cache for GET `/info` — used for `coverArtUrl` and related metadata. */

import type { Files } from "./files.ts";

type InfoJson = {
  contents?: Files;
};

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

let infoContentsPromise: Promise<Files | null> | null = null;

/** Resets the in-memory `/info` cache (e.g. after admin refresh). */
export function clearInfoClientCache(): void {
  infoContentsPromise = null;
}

/**
 * Returns `contents` from `/info`, cached for the lifetime of the page until
 * {@link clearInfoClientCache} runs.
 */
export function fetchInfoContents(): Promise<Files | null> {
  if (!infoContentsPromise) {
    infoContentsPromise = (async () => {
      try {
        const res = await fetch("/info");
        if (!res.ok) return null;
        const body = (await res.json()) as InfoJson;
        return typeof body.contents === "object" && body.contents !== null
          ? body.contents
          : null;
      } catch {
        return null;
      }
    })();
  }
  return infoContentsPromise;
}

/**
 * `coverArtUrl` for an album from the cached info document, or `null`.
 *
 * `artistId` and `albumId` may be raw path segments from a track URL (including
 * percent-encoding); they are decoded before lookup so they match `/info`
 * `contents` keys.
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
