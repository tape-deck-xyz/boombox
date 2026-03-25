/** @file Custom element for an album image.
 *
 * Renders album art from ID3 cover data. Uses the shared {@link createDataUrlFromBytes}
 * from `app/util/data-url.ts` to encode bytes as data URLs for img src (same encoding
 * logic as the server's album cover handler, which decodes via {@link decodeDataUrl}).
 */

import * as id3 from "id3js";
import { getFirstSong } from "../../../lib/album.ts";
import { createDataUrlFromBytes } from "../../util/data-url.ts";

/**
 * Retrieves ID3 metadata tags from an audio file URL.
 *
 * @param url - The URL of the audio file to extract ID3 tags from.
 * @returns A promise that resolves to the ID3 tags object containing metadata.
 */
const getId3Tags = async (url: string) => {
  const tags = await id3.fromUrl(url);
  return tags;
};

/**
 * Extracts album art from an audio file and converts it to a data URL.
 * Encoding is done via {@link createDataUrlFromBytes} (shared with server).
 *
 * @param url - The URL of the audio file containing the album art.
 * @returns A promise that resolves to a data URL string of the album art, or null if no album art is found.
 */
const getAlbumArtAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const tags = await getId3Tags(encodeURI(url));

    if (Array.isArray(tags?.images) && tags.images.length > 0) {
      const arrayBuffer = tags.images[0].data;
      const mimeType = tags.images[0].mime || "image/jpeg";

      return createDataUrlFromBytes(arrayBuffer, mimeType);
    }

    return null;
  } catch (_error) {
    // Silently fail - album art is optional
    return null;
  }
};

// CACHING ////////////////////////////////////////////////////////////////////

/** Cache of album art promises, keyed by album URL (not track URL) since album art is the same for all tracks in an album. */
const albumArtCache = new Map<string, Promise<string | null>>();

/**
 * Retrieves album art from an audio file and converts it to a data URL.
 * Cached by album URL to prevent re-fetching when tracks change within the same album.
 *
 * @param albumUrl - The full album URL (e.g., "https://bucket.s3.region.amazonaws.com/artist/album").
 * @param artistId - The artist ID.
 * @param albumId - The album ID.
 * @returns A promise that resolves to a data URL string of the album art, or null if no album art is found.
 */
const getAlbumArtAsDataUrlCached = async (
  albumUrl: string,
  artistId: string,
  albumId: string,
): Promise<string | null> => {
  // Cache by album URL, not track URL, since album art is the same for all tracks
  // Use the full albumUrl as the cache key
  if (!albumArtCache.has(albumUrl)) {
    // Get first song to extract album art from
    const albumUrlParts = albumUrl.split("/");
    const baseUrl = albumUrlParts.slice(0, -2).join("/"); // Remove artist and album from end
    const firstSong = await getFirstSong(
      baseUrl,
      artistId,
      albumId,
    );

    if (!firstSong) {
      return null;
    }

    // firstSong already contains the full path from bucket root (e.g., "artist/album/track1.mp3")
    // so just prepend the base URL
    const trackUrl = `${baseUrl}/${firstSong}`;
    albumArtCache.set(albumUrl, getAlbumArtAsDataUrl(trackUrl));
  }

  return albumArtCache.get(albumUrl)!;
};

// TEMPLATE ///////////////////////////////////////////////////////////////////

const template = document.createElement("template");

template.innerHTML = `
  <style>
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  </style>
  <img alt=""/>
`;

// ELEMENT ////////////////////////////////////////////////////////////////////

/**
 * Custom element for an album image.
 *
 * Fetches album art from the first track's ID3 tags and renders it as an img
 * inside a shadow root. Album art is cached by album URL so switching tracks
 * within the same album does not re-fetch. Silently renders nothing if no art
 * is found or if the fetch fails.
 *
 * @customElement album-image-custom-element
 *
 * @example
 * ```html
 * <album-image-custom-element
 *   data-album-url="https://bucket.s3.amazonaws.com/ArtistName/AlbumName">
 * </album-image-custom-element>
 * ```
 *
 * ## Attributes
 *
 * ### `data-album-url` (string)
 * Full S3 URL to the album directory. Must end with `/{artistId}/{albumId}`.
 * Changing this attribute triggers a new image load. If the same album URL is
 * already loaded, the image is not re-fetched.
 *
 * ### `data-cover-art-url` (string, optional)
 * Public HTTPS URL from the info document (`coverArtUrl`). When set, loaded first
 * with `fetchpriority="high"`; on load error, falls back to ID3 on the first track.
 *
 * ### `class` (string)
 * CSS class list forwarded to the inner img element so external styles apply
 * through the shadow DOM boundary.
 *
 * ### `style` (string)
 * Inline styles forwarded to the inner img element.
 */
export class AlbumImageCustomElement extends HTMLElement {
  static observedAttributes = [
    "data-album-url",
    "data-cover-art-url",
    "class",
    "style",
  ];

  private artistId: string | null = null;
  private albumId: string | null = null;
  /** Cache key: album URL + optional cover URL */
  private loadKey: string | null = null;
  private loadImageAbortController: AbortController | null = null;

  constructor() {
    super();

    // Create shadow root in constructor to encapsulate styles
    this.attachShadow({ mode: "open" });

    // Clone the template content and append it to the shadow root
    this.shadowRoot!.appendChild(template.content.cloneNode(true));

    this.updateImageClasses();
  }

  private async loadAlbumImage() {
    const albumUrl = this.getAttribute("data-album-url") || "";
    const coverArtUrl = this.getAttribute("data-cover-art-url");

    if (!albumUrl) {
      return;
    }

    const albumUrlParts = albumUrl.split("/");
    const albumId = albumUrlParts.pop();
    const artistId = albumUrlParts.pop();

    if (!artistId || !albumId) {
      return;
    }

    const nextKey = `${albumUrl}|${coverArtUrl ?? ""}`;
    if (this.loadKey === nextKey) {
      return;
    }

    if (this.loadImageAbortController) {
      this.loadImageAbortController.abort();
    }
    this.loadImageAbortController = new AbortController();
    const signal = this.loadImageAbortController.signal;

    this.artistId = artistId;
    this.albumId = albumId;
    this.loadKey = nextKey;

    const img = this.shadowRoot!.querySelector("img");
    if (!img) {
      return;
    }

    const applyId3Src = async (): Promise<void> => {
      try {
        const dataUrl = await getAlbumArtAsDataUrlCached(
          albumUrl,
          artistId,
          albumId,
        );
        if (signal.aborted || !dataUrl) {
          return;
        }
        img.removeAttribute("fetchpriority");
        img.setAttribute("src", dataUrl);
        if (img.complete && img.naturalHeight !== 0) {
          this.setAltText(img);
        } else {
          const loadHandler = () => {
            if (!signal.aborted) this.setAltText(img);
            img.removeEventListener("load", loadHandler);
            img.removeEventListener("error", errorHandler);
          };
          const errorHandler = () => {
            if (!signal.aborted) this.setAltText(img);
            img.removeEventListener("load", loadHandler);
            img.removeEventListener("error", errorHandler);
          };
          img.addEventListener("load", loadHandler, { once: true });
          img.addEventListener("error", errorHandler, { once: true });
          signal.addEventListener("abort", () => {
            img.removeEventListener("load", loadHandler);
            img.removeEventListener("error", errorHandler);
          });
        }
      } catch (_error) {
        // album art is optional
      }
    };

    if (coverArtUrl) {
      img.fetchPriority = "high";
      const coverOk = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (v: boolean) => {
          if (settled) return;
          settled = true;
          img.removeEventListener("load", onLoad);
          img.removeEventListener("error", onErr);
          resolve(v);
        };
        const onLoad = () => finish(true);
        const onErr = () => finish(false);
        img.addEventListener("load", onLoad, { once: true });
        img.addEventListener("error", onErr, { once: true });
        img.setAttribute("src", coverArtUrl);
        if (img.complete && img.naturalHeight > 0) {
          finish(true);
        }
        signal.addEventListener("abort", () => finish(false), { once: true });
      });

      if (signal.aborted) {
        return;
      }
      if (coverOk) {
        this.setAltText(img);
        return;
      }
    }

    await applyId3Src();
  }

  connectedCallback() {
    this.updateImageClasses();
    this.updateImageStyles();
    this.loadAlbumImage();
  }

  private setAltText(img: HTMLImageElement) {
    if (this.albumId && this.artistId) {
      img.setAttribute(
        "alt",
        `Album art for ${this.albumId} by ${this.artistId}`,
      );
    } else {
      img.setAttribute("alt", "Album art");
    }
  }

  private updateImageClasses() {
    const img = this.shadowRoot!.querySelector("img");
    if (img) {
      // Copy classes from custom element to img element
      img.setAttribute("class", this.getAttribute("class") || "");
    }
  }

  private updateImageStyles() {
    const img = this.shadowRoot!.querySelector("img");
    if (img) {
      // Copy styles from custom element to img element
      img.setAttribute("style", this.getAttribute("style") || "");
    }
  }

  disconnectedCallback() {
    // Clean up any pending image loads
    if (this.loadImageAbortController) {
      this.loadImageAbortController.abort();
      this.loadImageAbortController = null;
    }
  }

  connectedMoveCallback() {
    // Element moved in DOM - no action needed
  }

  adoptedCallback() {
    // Element moved to new document - no action needed
  }

  attributeChangedCallback(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _oldValue: string | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _newValue: string | null,
  ) {
    if (name === "class") {
      this.updateImageClasses();
    } else if (name === "data-album-url" || name === "data-cover-art-url") {
      this.loadAlbumImage();
    } else if (name === "style") {
      this.updateImageStyles();
    }
  }
}

customElements.define("album-image-custom-element", AlbumImageCustomElement);
