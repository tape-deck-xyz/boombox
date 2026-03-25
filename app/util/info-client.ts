/** @file Client fetch cache for GET `/info` — used for `coverArtUrl` and related metadata. */

import type { Files } from "./files.ts";

type InfoJson = {
  contents?: Files;
};

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
 */
export async function getCoverArtUrlForAlbum(
  artistId: string,
  albumId: string,
): Promise<string | null> {
  const contents = await fetchInfoContents();
  if (!contents) return null;
  const album = contents[artistId]?.[albumId];
  if (!album) return null;
  return album.coverArtUrl;
}
