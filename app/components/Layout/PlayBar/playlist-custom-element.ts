/** @file Custom element for a playlist button with popup showing remaining tracks in the album.
 *
 * Displays an icon button. When clicked, reveals a list of the remaining tracks in the album,
 * based on the specified album URL and current track ID. The user can click on a track to
 * dispatch a 'select' event (with detail: trackUrl, trackTitle, trackNum).
 *
 * @customElement playlist-custom-element
 *
 * @example
 * ```html
 * <playlist-custom-element
 *   data-album-url="/api/albums/123"
 *   data-current-track-id="track-456">
 * </playlist-custom-element>
 * ```
 *
 * @example
 * ```typescript
 * const playlist = document.querySelector('playlist-custom-element');
 * playlist.addEventListener('select', (e) => {
 *   const { url, title, trackNum } = e.detail;
 *   // Handle track selection
 * });
 * ```
 */

import { getRemainingAlbumTracks } from "../../../util/track.ts";
import "../../../icons/playlist/index.ts";

/**
 * Template for playlist popup and button.
 * Styles and structure are encapsulated in shadow DOM.
 * Contains the button, popover container, track list, and all associated styles.
 */
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: inline-block;
      position: relative;
      font-size: 16px;
    }
    .button {
      width: 3rem;
      height: 3rem;
      cursor: pointer;
      color: #fff;
      background: none;
      border: none;
    }
    .popover {
      display: none;
      position: absolute;
      right: 0;
      bottom: calc(100% + 0.5rem);
      z-index: 1000;
      min-width: 14rem;
      background: #18181b;
      color: #ccc;
      border-radius: 0.5rem;
      box-shadow: 0px 2px 18px 0 rgb(0 0 0 / 40%);
      padding: 0.75rem 0.5rem;
      transition: opacity 0.15s;
      max-height: 14rem;
      overflow-y: auto;
    }
    .popover.open {
      display: block;
    }
    ol, ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .track-btn {
      padding: 0.25rem 0.25rem;
      background: none;
      border: none;
      color: inherit;
      width: 100%;
      text-align: left;
      border-radius: 0.375rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 1rem;
      transition: background 0.1s;
    }
    .track-btn:hover, .track-btn:focus {
      background: #27272a;
      color: #fff;
    }
    .track-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .no-tracks {
      color: #666;
      text-align: center;
      padding: 0.5rem 0;
      font-size: 0.95rem;
    }
  </style>
  <button class="button" aria-label="Show playlist">
    <playlist-icon class="size-6"></playlist-icon>
  </button>
  <div class="popover" role="menu" aria-label="Playlist">
    <ol class="track-list"></ol>
    <div class="no-tracks" style="display: none;">No other tracks in album.</div>
  </div>
`;

/**
 * Custom element that displays a playlist button with a popup showing remaining tracks.
 *
 * Renders an icon button. When clicked, reveals a popover listing the remaining
 * tracks in the album (tracks after the current one). Clicking a track in the
 * list dispatches a `select` event with the track details. The popover closes
 * when clicking outside the element.
 *
 * @customElement playlist-custom-element
 *
 * @example
 * ```html
 * <playlist-custom-element
 *   data-album-url="https://bucket.s3.amazonaws.com/Artist/Album"
 *   data-current-track-id="https://bucket.s3.amazonaws.com/Artist/Album/01__Track.mp3">
 * </playlist-custom-element>
 * ```
 *
 * @example
 * ```typescript
 * const playlist = document.querySelector('playlist-custom-element');
 * playlist.addEventListener('select', (e: CustomEvent) => {
 *   const { url, title, trackNum } = e.detail;
 *   // Handle track selection
 * });
 * ```
 *
 * ## Attributes
 *
 * ### `data-album-url` (string)
 * Base S3 URL for the album. Used to fetch remaining tracks via
 * `getRemainingAlbumTracks`. The button is disabled when this attribute is absent.
 *
 * ### `data-current-track-id` (string)
 * URL of the currently playing track. Used to determine which tracks are
 * "remaining" (i.e., after the current track in the album).
 *
 * ## Events
 *
 * ### `select`
 * Dispatched when the user clicks a track in the playlist popup. Bubbles.
 *
 * **Event detail:**
 * ```typescript
 * {
 *   url: string;      // Track file URL
 *   title: string;    // Track display title
 *   trackNum: number; // Track number in the album
 * }
 * ```
 */
export class PlaylistCustomElement extends HTMLElement {
  /**
   * Attributes that trigger `attributeChangedCallback` when modified.
   *
   * - `data-album-url`: The URL endpoint for fetching album tracks
   * - `data-current-track-id`: The ID of the currently playing track
   */
  static observedAttributes = [
    "data-album-url",
    "data-current-track-id",
  ];

  /**
   * The album URL from the `data-album-url` attribute.
   * Used to fetch remaining tracks via `getRemainingAlbumTracks`.
   *
   * @private
   */
  private albumUrl: string | null = null;

  /**
   * The current track ID from the `data-current-track-id` attribute.
   * Used to filter out the current track from the remaining tracks list.
   *
   * @private
   */
  private currentTrackId: string | null = null;

  /**
   * Array of remaining tracks in the album (excluding the current track).
   * Each track contains:
   * - `url`: The URL/path to the track file
   * - `title`: The display title of the track
   * - `trackNum`: The track number in the album
   *
   * @private
   */
  private remainingTracks: Array<{
    url: string;
    title: string;
    trackNum: number;
  }> = [];

  /**
   * Whether the popover is currently open/visible.
   * Controls the visibility of the track list popup.
   *
   * @private
   */
  private popoverOpen = false;

  /**
   * Promise for the current track loading operation.
   * Used to debounce rapid attribute changes and prevent race conditions.
   *
   * @private
   */
  private loadPromise: Promise<void> | null = null;

  /**
   * Creates a new PlaylistCustomElement instance.
   *
   * Initializes the shadow DOM, clones the template content, and binds event handlers.
   * The shadow DOM is opened to allow external styling access if needed.
   */
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleTrackClick = this.handleTrackClick.bind(this);
  }

  /**
   * Called when the element is inserted into the DOM.
   *
   * Sets up event listeners for the playlist button and initializes the component
   * by rendering the popover and loading tracks based on current attributes.
   */
  connectedCallback() {
    this.shadowRoot!.querySelector(".button")!
      .addEventListener("click", this.handleButtonClick);
    this.renderPopover();
    this.updateAttributes();
  }

  /**
   * Called when the element is removed from the DOM.
   *
   * Cleans up event listeners to prevent memory leaks. Removes both the button
   * click listener and the document click listener used for closing the popover.
   */
  disconnectedCallback() {
    this.shadowRoot!.querySelector(".button")!
      .removeEventListener("click", this.handleButtonClick);
    document.removeEventListener("click", this.handleDocumentClick);
  }

  /**
   * Called when an observed attribute changes.
   *
   * Responds to changes in `data-album-url` or `data-current-track-id` by
   * updating internal state and reloading tracks.
   *
   * @param name - The name of the attribute that changed
   * @param _oldVal - The previous value of the attribute (unused)
   * @param _newVal - The new value of the attribute (unused)
   */
  attributeChangedCallback(
    name: string,
    _oldVal: string | null,
    _newVal: string | null,
  ) {
    if (name === "data-album-url" || name === "data-current-track-id") {
      this.updateAttributes();
    }
  }

  /**
   * Updates internal state from element attributes and reloads tracks.
   *
   * Reads the `data-album-url` and `data-current-track-id` attributes,
   * updates the corresponding private properties, renders the popover,
   * and asynchronously loads the remaining tracks.
   *
   * @private
   */
  private async updateAttributes() {
    this.albumUrl = this.getAttribute("data-album-url");
    this.currentTrackId = this.getAttribute("data-current-track-id");
    this.renderPopover();
    await this.loadTracks();
  }

  /**
   * Loads the remaining tracks from the album asynchronously.
   *
   * Fetches tracks using `getRemainingAlbumTracks` based on the current
   * `albumUrl` and `currentTrackId`. Implements debouncing to prevent
   * race conditions when attributes change rapidly. On error, sets
   * `remainingTracks` to an empty array.
   *
   * If `albumUrl` or `currentTrackId` are missing, clears the tracks
   * and returns early.
   *
   * @private
   * @returns A promise that resolves when tracks are loaded or failed to load
   */
  private loadTracks(): Promise<void> {
    if (!this.albumUrl || !this.currentTrackId) {
      this.remainingTracks = [];
      this.renderPopover();
      return Promise.resolve();
    }
    // Debounce loading: avoid racing on rapid updates
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        this.remainingTracks = await getRemainingAlbumTracks(
          this.albumUrl!,
          this.currentTrackId!,
        );
      } catch {
        this.remainingTracks = [];
      } finally {
        this.renderPopover();
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  /**
   * Handles clicks on the playlist button.
   *
   * Toggles the popover open/closed state. When opening, adds a document-level
   * click listener (with a slight delay to avoid immediate closure) to detect
   * clicks outside the element. When closing, removes the document listener.
   *
   * @private
   * @param e - The click event from the button
   */
  private handleButtonClick(e: Event) {
    e.stopPropagation();
    this.popoverOpen = !this.popoverOpen;
    this.renderPopover();
    if (this.popoverOpen) {
      setTimeout(
        () => document.addEventListener("click", this.handleDocumentClick),
        0,
      );
    } else {
      document.removeEventListener("click", this.handleDocumentClick);
    }
  }

  /**
   * Handles document-level clicks to close the popover when clicking outside.
   *
   * Checks if the click occurred outside the element using the event's
   * composed path. If the click was inside the element (including shadow DOM),
   * the popover remains open. Otherwise, closes the popover and removes
   * the document listener.
   *
   * @private
   * @param event - The click event from the document
   */
  private handleDocumentClick(event: Event) {
    // Only close if click is outside the shadow DOM root
    if (!this.shadowRoot) return;
    // The click event's composed path includes our button/popover if it was inside
    const path = event.composedPath();
    if (path.includes(this)) return;
    this.popoverOpen = false;
    this.renderPopover();
    document.removeEventListener("click", this.handleDocumentClick);
  }

  /**
   * Handles clicks on individual track items in the playlist.
   *
   * Extracts the track index from the button's `data-track-idx` attribute,
   * retrieves the corresponding track from `remainingTracks`, and dispatches
   * a custom 'select' event with the track details. Closes the popover after
   * selection.
   *
   * The dispatched event has the following structure:
   * ```typescript
   * {
   *   type: 'select',
   *   detail: {
   *     url: string,
   *     title: string,
   *     trackNum: number
   *   },
   *   bubbles: true
   * }
   * ```
   *
   * @private
   * @param event - The click event from a track button
   */
  private handleTrackClick(event: Event) {
    const btn = event.currentTarget as HTMLButtonElement;
    const idx = btn.getAttribute("data-track-idx");
    if (!idx) return;
    const trackIdx = Number(idx);
    const track = this.remainingTracks[trackIdx];
    if (track) {
      // Dispatch a custom event when a track is selected
      this.dispatchEvent(
        new CustomEvent("select", {
          detail: {
            url: track.url,
            title: track.title,
            trackNum: track.trackNum,
          },
          bubbles: true,
        }),
      );
      this.popoverOpen = false;
      this.renderPopover();
    }
  }

  /**
   * Renders the popover UI based on current state.
   *
   * Updates the button disabled state, popover visibility, and track list.
   * Cleans up previous event listeners before rebuilding the track list to
   * prevent memory leaks. Shows a "No other tracks" message when there are
   * no remaining tracks.
   *
   * The button is disabled when `albumUrl` is not set. The popover is only
   * visible when both `popoverOpen` is true and `albumUrl` is set.
   *
   * Each track button includes:
   * - The track title (with ellipsis for overflow)
   * - A chevron-right icon
   * - A `data-track-idx` attribute for identifying the track
   *
   * @private
   */
  private renderPopover() {
    if (!this.shadowRoot) return;
    // Button state
    const btn = this.shadowRoot.querySelector(".button") as HTMLButtonElement;
    if (!this.albumUrl) btn?.setAttribute("disabled", "");
    else btn?.removeAttribute("disabled");

    const popover = this.shadowRoot.querySelector(".popover") as HTMLDivElement;
    if (this.popoverOpen && this.albumUrl) {
      popover.classList.add("open");
    } else {
      popover.classList.remove("open");
    }

    // Track list
    const ol = this.shadowRoot.querySelector(".track-list") as HTMLOListElement;
    ol.innerHTML = "";
    // Remove previous listeners
    for (const btnEl of Array.from(ol.querySelectorAll("button"))) {
      btnEl.removeEventListener("click", this.handleTrackClick);
    }

    if (this.remainingTracks.length > 0) {
      this.shadowRoot.querySelector(".no-tracks")!.setAttribute(
        "style",
        "display: none;",
      );
      this.remainingTracks.forEach((track, idx) => {
        const button = document.createElement("button");
        button.className = "track-btn";
        button.type = "button";
        button.setAttribute("data-track-idx", idx.toString());
        button.innerHTML = `
          <span class="track-title">${track.title}</span>
          <svg style="width:1em;height:1em;" fill="none" stroke="currentColor" stroke-width="1.7"
              viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
             d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
          </svg>
        `;
        button.addEventListener("click", this.handleTrackClick);
        const li = document.createElement("li");
        li.appendChild(button);
        ol.appendChild(li);
      });
    } else {
      this.shadowRoot.querySelector(".no-tracks")!.removeAttribute("style");
    }
  }
}

customElements.define("playlist-custom-element", PlaylistCustomElement);
