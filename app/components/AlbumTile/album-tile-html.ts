/** @file Album tile HTML function.
 *
 * Renders a clickable tile (cover art + title/artist) for an album. Uses
 * `<nav-link>` so navigation to the album page uses client-side fragment
 * loading when possible.
 */

import type { Files } from "../../util/files.ts";
import { getAlbum } from "../../util/files.ts";

/**
 * Props for the album tile HTML function
 */
export interface AlbumTileProps {
  albumId: string;
  files: Files;
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate HTML string for album tile with cover art and title/artist text
 *
 * Returns HTML immediately with a link containing album cover and metadata.
 *
 * @param props - Album tile properties
 * @returns HTML string for an anchor element with album cover and text
 *
 * @example
 * ```ts
 * const html = albumTileHtml({
 *   albumId: "Artist Name/Album Name",
 *   files: filesObject
 * });
 * ```
 */
export default function albumTileHtml(
  props: AlbumTileProps,
): string {
  const { albumId, files } = props;
  const [artistName, albumName] = albumId.split("/");

  const encodedArtistName = encodeURIComponent(artistName);
  const encodedAlbumName = encodeURIComponent(albumName);
  const href = `/artists/${encodedArtistName}/albums/${encodedAlbumName}`;

  const escapedArtistName = escapeHtml(artistName);
  const escapedAlbumName = escapeHtml(albumName);

  const albumObject = getAlbum(files, albumId);
  const srcArr = albumObject.tracks[0].url.split("/");
  srcArr.pop();
  const coverArtUrl = albumObject.coverArtUrl;
  const coverAttr = coverArtUrl
    ? ` data-cover-art-url="${escapeHtml(coverArtUrl)}"`
    : "";

  return `<nav-link href="${escapeHtml(href)}">
  <album-image-custom-element style="width: 100%; border-radius: 4px; aspect-ratio: 1/1; display: inline-block;" data-album-url="${
    escapeHtml(srcArr.join("/"))
  }"${coverAttr}></album-image-custom-element>
  <div class="pt-1 md:pt-2">
    <p class="text-base font-bold line-clamp-1">${escapedAlbumName}</p>
    <p class="text-sm line-clamp-1">by ${escapedArtistName}</p>
  </div>
</nav-link>`;
}
