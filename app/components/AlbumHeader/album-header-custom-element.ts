/** @file Custom element for the header on an album page. */

import * as id3 from "id3js";
import { extractColors } from "extract-colors";
import type { AlbumUrl } from "../../../lib/album.ts";
import { getFirstSong } from "../../../lib/album.ts";

/**
 * Extracts dominant colors from an album art image URL.
 *
 * @param objectUrl - The object URL (blob URL) of the album art image.
 * @returns A promise that resolves to an array of color objects extracted from the image.
 */
const extractAlbumArtColors = async (objectUrl: string) => {
  const colors = await extractColors(objectUrl);
  return colors;
};

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
 * Extracts gradient colors from album art for use in the header background.
 *
 * @param url - The URL of the audio file containing the album art.
 * @returns A promise that resolves to an array of two hex color strings [startColor, endColor], or null if no album art is found.
 */
const getAlbumHeaderGradient = async (url: string) => {
  const tags = await getId3Tags(url);

  if (Array.isArray(tags?.images)) {
    const arrayBuffer = tags.images[0].data;
    const blob = new Blob([arrayBuffer]);
    const srcBlob = URL.createObjectURL(blob);
    try {
      const colors = await extractAlbumArtColors(srcBlob);
      return [colors[0].hex, colors[colors.length - 1].hex];
    } finally {
      URL.revokeObjectURL(srcBlob);
    }
  }

  return null;
};

/**
 * Dominant colors from a public cover image URL (e.g. `coverArtUrl` from `/info`).
 * Uses CORS; returns null if fetch or parsing fails.
 */
const getAlbumHeaderGradientFromImageUrl = async (
  imageUrl: string,
): Promise<string[] | null> => {
  try {
    const res = await fetch(imageUrl, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const colors = await extractAlbumArtColors(objectUrl);
      if (!colors?.length) return null;
      return [colors[0].hex, colors[colors.length - 1].hex];
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
};

/**
 * Applies a gradient background to the album header element using extracted colors.
 *
 * @param elm - The HTML element to apply the gradient to.
 * @param colors - An array of two hex color strings [startColor, endColor] for the gradient.
 */
const setAlbumHeaderGradient = (elm: HTMLElement, colors: string[]) => {
  elm.setAttribute(
    "style",
    `background: linear-gradient(to bottom, ${colors[0]}, ${colors[1]});`,
  );
};

/** Album header styles (encapsulated in shadow DOM). */
const albumHeaderStyles = `
  .album-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: linear-gradient(to bottom, #3a1c5c, #1a1a2e);
    padding: 16px 16px;
    transition: padding 0.15s ease-out;
    will-change: padding;
  }

  .album-header.shrunk {
    padding: 12px 12px;
  }

  .album-content {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .album-header.shrunk .album-content {
    gap: 8px;
  }

  .album-art {
    width: 120px;
    height: 120px;
    border-radius: 8px;
    background: linear-gradient(135deg,rgb(0, 0, 0) 0%,rgb(0, 0, 0) 100%);
    flex-shrink: 0;
    transition: width 0.15s ease-out, height 0.15s ease-out;
    font-size: 48px;
  }

  .album-header.shrunk .album-art {
    width: 56px;
    height: 56px;
    font-size: 24px;
  }

  .album-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 120px;
    min-width: 0;
  }

  .album-title {
    margin: 0;
    font-size: 32px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: font-size 0.15s ease-out;
  }

  .album-header.shrunk .album-title {
    font-size: 18px;
  }

  .album-artist {
    margin: 0;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
    transition: font-size 0.15s ease-out;
  }

  .album-header.shrunk .album-artist {
    font-size: 12px;
  }

  .album-meta {
    margin: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 4px;
    transition: opacity 0.15s ease-out, height 0.15s ease-out;
  }

  .album-header.shrunk .album-meta {
    opacity: 0;
    height: 0;
    margin: 0;
    overflow: hidden;
  }
`;

/**
 * Custom element for the sticky, shrinking header on an album page.
 *
 * Displays album art, title, and artist. The header shrinks as the user scrolls
 * down using an `IntersectionObserver` on a sentinel element. The background
 * gradient is derived from the album art's dominant colors via `extractColors`.
 *
 * @customElement album-header-custom-element
 *
 * @example
 * ```html
 * <album-header-custom-element
 *   data-album-url="https://bucket.s3.amazonaws.com/ArtistName/AlbumName">
 * </album-header-custom-element>
 * ```
 *
 * ## Attributes
 *
 * ### `data-album-url` (string, required)
 * Full S3 URL to the album directory. Must end with `/{artistId}/{albumId}`.
 * Used to derive the artist and album names for display, and to fetch the first
 * track for album art and gradient color extraction when `data-cover-art-url` is absent.
 * Throws at construction time if missing or malformed.
 *
 * ### `data-cover-art-url` (string, optional)
 * Public HTTPS URL from the info document. Passed to the nested album image and used
 * to derive the header gradient when CORS allows; otherwise falls back to ID3-based colors.
 */
export class AlbumHeaderCustomElement extends HTMLElement {
  static observedAttributes = ["data-album-url", "data-cover-art-url"];

  private scrollSentinel: HTMLDivElement | null = null;
  private scrollObserver: IntersectionObserver | null = null;

  constructor() {
    super();

    if (!this.getAttribute("data-album-url")) {
      throw new Error("Album URL is required");
    }

    const albumUrl = this.getAttribute("data-album-url") as AlbumUrl;
    const albumUrlParts = albumUrl.split("/");
    const albumId = albumUrlParts.pop();
    const artistId = albumUrlParts.pop();

    if (!artistId || !albumId) {
      throw new Error(
        "Artist ID or album ID missing or mis-configured in data-album-url attribute",
      );
    }

    this.attachShadow({ mode: "open" });

    const template = document.createElement("template");
    template.innerHTML = `
  <style>${albumHeaderStyles}</style>
  <header class="album-header" id="albumHeader">
    <div class="album-content">
      <div class="album-art"><album-image-custom-element data-album-url="${albumUrl}"></album-image-custom-element></div>
      <div class="album-info">
        <h1 class="album-title">${albumId}</h1>
        <p class="album-artist">${artistId}</p>
        <p class="album-meta">2024 • 12 songs • 48 min</p>
      </div>
    </div>
  </header>
`;
    this.shadowRoot!.appendChild(template.content.cloneNode(true));

    const coverArtUrl = this.getAttribute("data-cover-art-url");
    const albumImage = this.shadowRoot!.querySelector(
      "album-image-custom-element",
    );
    if (coverArtUrl && albumImage) {
      albumImage.setAttribute("data-cover-art-url", coverArtUrl);
    }

    const applyGradient = (colors: string[] | null) => {
      if (!colors?.length) return;
      const header = this.shadowRoot?.querySelector(".album-header");
      if (header) {
        setAlbumHeaderGradient(header as HTMLElement, colors);
      }
    };

    const fromId3 = () => {
      getFirstSong(albumUrlParts.join("/"), artistId, albumId).then(
        (firstSong) => {
          if (!firstSong) return;
          const trackUrl = albumUrlParts.join("/") + "/" + firstSong;
          getAlbumHeaderGradient(trackUrl).then(applyGradient);
        },
      );
    };

    if (coverArtUrl) {
      getAlbumHeaderGradientFromImageUrl(coverArtUrl).then((colors) => {
        if (colors) {
          applyGradient(colors);
        } else {
          fromId3();
        }
      });
    } else {
      fromId3();
    }
  }

  connectedCallback() {
    // Scroll handling with Intersection Observer for efficiency.
    // Use the scroll container: next sibling (when header is before the scroll area)
    // or nearest scrollable ancestor; otherwise viewport (body scroll).
    const scrollRoot = this.nextElementSibling ??
      this.findScrollableAncestor();
    const sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    sentinel.style.pointerEvents = "none";
    sentinel.setAttribute("aria-hidden", "true");
    if (scrollRoot) {
      sentinel.style.position = "absolute";
      sentinel.style.top = "60px"; // Trigger point (px scrolled before shrink)
      sentinel.style.left = "0";
      sentinel.style.right = "0";
      scrollRoot.insertBefore(sentinel, scrollRoot.firstChild);
    } else {
      sentinel.style.position = "absolute";
      sentinel.style.top = "60px";
      sentinel.style.left = "0";
      sentinel.style.right = "0";
      document.body.insertBefore(sentinel, this);
    }

    this.scrollSentinel = sentinel;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const header = this.shadowRoot?.querySelector(".album-header");
          // When sentinel is NOT intersecting (scrolled past), shrink header
          if (!entry.isIntersecting) {
            header?.classList.add("shrunk");
          } else {
            header?.classList.remove("shrunk");
          }
        });
      },
      {
        threshold: 0,
        rootMargin: "0px",
        root: scrollRoot,
      },
    );

    observer.observe(sentinel);
    this.scrollObserver = observer;
  }

  /**
   * Returns the nearest ancestor that has overflow-y auto/scroll/overlay,
   * or null if none (viewport is the scroll context).
   */
  private findScrollableAncestor(): Element | null {
    let el: Element | null = this.parentElement;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if (
        overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay"
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  disconnectedCallback() {
    if (this.scrollObserver && this.scrollSentinel) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
      this.scrollSentinel.remove();
      this.scrollSentinel = null;
    }
  }

  connectedMoveCallback() {
    console.log("Custom element moved with moveBefore()");
  }

  adoptedCallback() {
    console.log("Custom element moved to new page.");
  }

  attributeChangedCallback(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _oldValue: string | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _newValue: string | null,
  ) {
    console.log(`Attribute ${name} has changed.`);
  }
}

customElements.define("album-header-custom-element", AlbumHeaderCustomElement);
