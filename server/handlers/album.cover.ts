/** @file Handler for album cover image at `GET /artists/:artistId/albums/:albumId/cover`.
 *
 * Serves **`artist/album/cover.jpeg`** from S3 when that object exists; otherwise loads
 * the first track (by track number), extracts ID3 picture via {@link getID3Tags}, and
 * decodes with {@link decodeDataUrl}. Responses are cached in memory by album key.
 */

import { decodeDataUrl } from "../../app/util/data-url.ts";
import {
  coverObjectKey,
  getObjectBytes,
  getUploadedFiles,
} from "../../app/util/s3.server.ts";
import { getAlbum, sortTracksByTrackNumber } from "../../app/util/files.ts";
import { getID3Tags } from "../../app/util/id3.ts";
import { createLogger } from "../../app/util/logger.ts";

const logger = createLogger("Album Cover");

/** In-memory cache: album key -> { body, contentType } */
const coverCache = new Map<
  string,
  { body: Uint8Array; contentType: string }
>();

/** Clears in-memory cover responses (for tests). */
export function clearAlbumCoverHandlerCache(): void {
  coverCache.clear();
}

/** Splits `album.id` into S3 path segments (artist name / album name). */
function artistAndAlbumFromAlbumId(albumId: string): {
  artist: string;
  album: string;
} {
  const i = albumId.indexOf("/");
  if (i <= 0 || i >= albumId.length - 1) {
    throw new Error(`Invalid album id: ${albumId}`);
  }
  return { artist: albumId.slice(0, i), album: albumId.slice(i + 1) };
}

/**
 * Get S3 object key from a track URL.
 *
 * @param trackUrl - Full track URL (e.g. https://bucket.s3.region.amazonaws.com/artist/album/1__Title.mp3)
 * @returns Decoded path segment used as S3 key (e.g. "artist/album/1__Title.mp3")
 */
export function getKeyFromTrackUrl(trackUrl: string): string {
  const pathname = new URL(trackUrl).pathname;
  const key = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/**
 * Handle GET request for album cover image.
 *
 * @param _req - The request (unused; route params carry artist/album).
 * @param params - Route params: artistId, albumId.
 * @returns Response with image body, or 400/404/500 with message.
 */
export async function handleAlbumCover(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { artistId, albumId } = params;
  logger.info("Handling album cover", { artistId, albumId });

  if (!artistId || !albumId) {
    return new Response("Missing artist or album ID", { status: 400 });
  }

  const cacheKey = `${artistId}/${albumId}`;
  const cached = coverCache.get(cacheKey);
  if (cached) {
    logger.debug("Serving cover from cache", { cacheKey });
    const body = new Blob([new Uint8Array(cached.body)], {
      type: cached.contentType,
    });
    return new Response(body, {
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  const files = await getUploadedFiles();
  const album = getAlbum(files, cacheKey);
  if (!album) {
    return new Response("Album not found", { status: 404 });
  }

  const tracks = [...album.tracks].sort(sortTracksByTrackNumber);
  const firstTrack = tracks[0];
  if (!firstTrack) {
    return new Response("Album has no tracks", { status: 404 });
  }

  const { artist, album: albumName } = artistAndAlbumFromAlbumId(album.id);
  const coverKey = coverObjectKey(artist, albumName);

  try {
    const jpegBytes = await getObjectBytes(coverKey);
    const entry = { body: jpegBytes, contentType: "image/jpeg" };
    coverCache.set(cacheKey, entry);
    logger.debug("Cached cover from S3 object", { cacheKey, coverKey });
    const body = new Blob([new Uint8Array(jpegBytes)], {
      type: entry.contentType,
    });
    return new Response(body, {
      headers: {
        "Content-Type": entry.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (s3Err) {
    logger.debug("S3 cover object unavailable, trying ID3", {
      cacheKey,
      coverKey,
      error: s3Err instanceof Error ? s3Err.message : String(s3Err),
    });
  }

  try {
    const key = getKeyFromTrackUrl(firstTrack.url);
    const trackBytes = await getObjectBytes(key);
    const id3Tags = await getID3Tags(trackBytes);
    if (!id3Tags.image) {
      return new Response("No cover art in album tracks", { status: 404 });
    }
    const decoded = decodeDataUrl(id3Tags.image);
    if (!decoded) {
      return new Response("Invalid cover image data", { status: 500 });
    }
    coverCache.set(cacheKey, decoded);
    logger.debug("Cached cover from ID3", { cacheKey });
    const body = new Blob([new Uint8Array(decoded.body)], {
      type: decoded.contentType,
    });
    return new Response(body, {
      headers: {
        "Content-Type": decoded.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to extract cover", { error: message, cacheKey });
    return new Response("Failed to load cover", { status: 500 });
  }
}
