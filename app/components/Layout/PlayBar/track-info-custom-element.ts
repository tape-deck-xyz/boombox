/** @file Custom element for track info seen at the bottom of the screen */

import { parseTrackMetadataFromUrlText } from "../../../util/track-metadata.ts";
import "../../../components/ScrollingText/index.ts";

// TEMPLATE ///////////////////////////////////////////////////////////////////

const template = document.createElement("template");

template.innerHTML = `
  <style>
    :host {
      display: block;
      width: 100%;
      height: 100%;
      color: #fff;
    }
    .root {
      align-items: center;
      display: flex;
    }
    .album-image {
      display: inline-block;
      min-width: var(--playbar-album-size, 96px);
      height: var(--playbar-album-size, 96px);
      flex-shrink: 0;
    }
    .text-container {
      margin-left: var(--playbar-gap, 1rem);
      overflow: hidden;
      min-width: 0;
    }
    scrolling-text-custom-element.primary {
      font-size: var(--font-size-primary, 1rem);
    }
    scrolling-text-custom-element.secondary {
      font-size: var(--font-size-secondary, 0.875rem);
    }
    .text-row {
      display: flex;
      align-items: center;
    }
  </style>
  <div class="root">
    <album-image-custom-element data-album-url="" class="album-image"></album-image-custom-element>
    <div class="text-container">
      <scrolling-text-custom-element class="primary"></scrolling-text-custom-element>
      <div class="text-row">
        <scrolling-text-custom-element class="secondary"></scrolling-text-custom-element>
      </div>
    </div>
  </div>
`;

// ELEMENT ////////////////////////////////////////////////////////////////////

/**
 * Custom element for displaying current track info in the playbar.
 *
 * Shows the album art, track title, and "Album, Artist" subtitle for the
 * currently playing track. Parses all metadata from the track URL using
 * `parseTrackMetadataFromUrlText` — no additional attributes required.
 *
 * @customElement track-info-custom-element
 *
 * @example
 * ```html
 * <track-info-custom-element
 *   data-track-url="https://bucket.s3.amazonaws.com/Artist/Album/01__Track.mp3">
 * </track-info-custom-element>
 * ```
 *
 * ## Attributes
 *
 * ### `data-track-url` (string)
 * Full URL to the audio file. Expected format:
 * `{baseUrl}/{artistName}/{albumName}/{trackNumber}__{trackName}.{ext}`.
 * Changing this attribute updates the displayed track info immediately.
 * An empty or missing value renders nothing.
 */
export class TrackInfoCustomElement extends HTMLElement {
  static observedAttributes = [
    "data-track-url",
  ];

  private trackUrl: string | null = null;

  constructor() {
    super();

    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
  }

  connectedCallback() {
    this.updateAttributes();
    this.render();
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ) {
    if (name === "data-track-url") {
      this.updateAttributes();
      this.render();
    }
  }

  private updateAttributes() {
    this.trackUrl = this.getAttribute("data-track-url") || null;
  }

  private render() {
    const trackUrl = this.trackUrl;
    if (!trackUrl) {
      return;
    }

    const trackMetadata = parseTrackMetadataFromUrlText(trackUrl);

    this.shadowRoot!.querySelector("album-image-custom-element")!.setAttribute(
      "data-album-url",
      trackMetadata.albumUrl || "",
    );
    this.shadowRoot!.querySelector("scrolling-text-custom-element.primary")!
      .textContent = trackMetadata.title;
    this.shadowRoot!.querySelector("scrolling-text-custom-element.secondary")!
      .textContent = `${trackMetadata.album}, ${trackMetadata.artist}`;
  }
}

customElements.define("track-info-custom-element", TrackInfoCustomElement);
