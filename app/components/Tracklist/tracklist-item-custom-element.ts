/** @file Custom element for a tracklist item. */

/**
 * Custom element for a track list item. Handles loading the track duration
 * and displays track information including name, artist, track number, and duration.
 *
 * @customElement tracklist-item-custom-element
 *
 * @example
 * ```html
 * <tracklist-item-custom-element
 *   data-track-name="Song Title"
 *   data-track-artist="Artist Name"
 *   data-track-number="1"
 *   data-track-url="/path/to/track.mp3">
 * </tracklist-item-custom-element>
 * ```
 *
 * @example
 * ```typescript
 * const element = document.querySelector('tracklist-item-custom-element');
 * element.addEventListener('track-click', (e) => {
 *   console.log('Track clicked:', e.detail.trackUrl);
 * });
 * ```
 *
 * ## Attributes
 *
 * ### `data-track-name` (string, required)
 * The name/title of the track. Displayed as the primary text in the track item.
 *
 * ### `data-track-artist` (string, required)
 * The artist name for the track. Displayed below the track name.
 *
 * ### `data-track-number` (string, required)
 * The track number within the album. Displayed on the left side of the track item.
 *
 * ### `data-track-url` (string, required)
 * The URL to the audio file. Used to load track metadata (duration) and provided
 * in the `track-click` event detail when the item is clicked. Should be URL-encoded.
 *
 * ## Events
 *
 * ### `track-click`
 * Dispatched when the track item is clicked. The event bubbles up the DOM tree.
 *
 * **Event Detail:**
 * ```typescript
 * {
 *   trackUrl: string; // The track URL from data-track-url attribute
 * }
 * ```
 *
 * @example
 * ```typescript
 * element.addEventListener('track-click', (event: CustomEvent) => {
 *   const { trackUrl } = event.detail;
 *   // Handle track selection
 * });
 * ```
 */
export class TracklistItemCustomElement extends HTMLElement {
  /**
   * Attributes that trigger `attributeChangedCallback` when modified.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Web_Components/Using_custom_elements#observed_attributes | MDN: Observed Attributes}
   */
  static observedAttributes = [
    "data-track-name",
    "data-track-artist",
    "data-track-number",
    "data-track-url",
  ];

  private trackName: string | null = null;
  private trackArtist: string | null = null;
  private trackDuration: string | null = null;
  private trackNumber: string | null = null;

  /**
   * Sets the track duration from audio metadata and updates the display.
   *
   * Validates the duration value and formats it as "MM:SS" before updating
   * the duration element in the DOM.
   *
   * @param _evt - The event that triggered this callback (unused).
   * @param audio - The HTMLAudioElement containing the loaded audio metadata.
   */
  setTrackDuration(_evt: Event, audio: HTMLAudioElement) {
    // Validate duration
    if (!audio.duration || !isFinite(audio.duration) || isNaN(audio.duration)) {
      console.warn("Invalid duration for track", {
        trackName: this.trackName,
        duration: audio.duration,
      });
      return;
    }

    const minutes = Math.floor(audio.duration / 60);
    const seconds = Math.floor(audio.duration % 60);
    this.trackDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    const durElement = this.querySelector(".track-duration") as HTMLElement;
    if (durElement) {
      durElement.textContent = this.trackDuration;
    }
  }

  /**
   * Loads track duration metadata from the audio file URL.
   *
   * Creates an HTMLAudioElement with preload set to "metadata" to efficiently
   * load only the metadata needed for duration. Handles both successful loads
   * and errors (including HTTP 416 Range Not Satisfiable).
   *
   * @param trackUrl - The URL of the audio file to load metadata from.
   */
  private loadTrackDuration(trackUrl: string) {
    if (!trackUrl) {
      console.warn("No track URL provided for track", this.trackName);
      return;
    }

    const audio = new Audio(trackUrl);

    // Set preload to metadata to ensure metadata is loaded
    audio.preload = "metadata";

    // Handle errors (including 416 Range Not Satisfiable)
    const handleError = () => {
      const error = audio.error;
      console.error("Failed to load audio metadata", {
        trackName: this.trackName,
        trackUrl,
        errorCode: error?.code,
        errorMessage: error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
      });

      // Clean up listeners
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);

      // Optionally show a fallback or retry
      const durElement = this.querySelector(".track-duration") as HTMLElement;
      if (durElement && !this.trackDuration) {
        durElement.textContent = " ";
      }
    };

    // Handle successful metadata load
    const handleLoadedMetadata = (evt: Event) => {
      this.setTrackDuration(evt, audio);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);

    // Try to load metadata
    audio.load();
  }

  /**
   * Handles click events on the track item.
   *
   * Dispatches a custom `track-click` event with the track URL
   * in the event detail. The event bubbles up the DOM tree.
   *
   * @private
   */
  private clickHandler = () => {
    const evt = new CustomEvent(
      "track-click",
      {
        bubbles: true,
        detail: {
          trackUrl: this.getAttribute("data-track-url") || "",
        },
      },
    );

    this.dispatchEvent(evt);
  };

  /**
   * Creates a new TracklistItemCustomElement instance.
   *
   * Initializes the element by reading attributes and setting up the internal
   * HTML structure. Automatically begins loading track duration metadata.
   */
  constructor() {
    super();

    this.trackName = this.getAttribute("data-track-name") || "";
    this.trackArtist = this.getAttribute("data-track-artist") || "";
    this.trackNumber = this.getAttribute("data-track-number") || "";

    // Handle loading the track duration
    const trackUrl = this.getAttribute("data-track-url") || "";
    this.loadTrackDuration(trackUrl);

    this.innerHTML = `
      <div class="track">
      <style>
.track {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 4px;
      transition: background 0.2s;
    }

    .track:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .track-number {
      width: 32px;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.5);
    }

    .track-info {
      flex: 1;
      min-width: 0;
    }

    .track-name {
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-artist {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);
    }

    .track-duration {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);
      margin-left: 16px;
    }
      </style>
        <span class="track-number">${this.trackNumber}</span>
        <div class="track-info">
          <div class="track-name">${this.trackName}</div>
          <div class="track-artist">${this.trackArtist}</div>
        </div>
        <span class="track-duration">${this.trackDuration || " "}</span>
      </div>
    `;
  }

  /**
   * Called when the element is inserted into the DOM.
   *
   * Sets up the click event listener for track selection.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Web_Components/Using_custom_elements#lifecycle_callbacks | MDN: Lifecycle Callbacks}
   */
  connectedCallback() {
    this.addEventListener("click", this.clickHandler);
  }

  /**
   * Called when the element is removed from the DOM.
   *
   * Cleans up event listeners to prevent memory leaks.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Web_Components/Using_custom_elements#lifecycle_callbacks | MDN: Lifecycle Callbacks}
   */
  disconnectedCallback() {
    this.removeEventListener("click", this.clickHandler);
  }

  /**
   * Called when one of the element's observed attributes changes.
   *
   * Currently, attribute changes do not trigger any updates. This callback
   * is present to satisfy the Custom Elements API requirements.
   *
   * @param _name - The name of the attribute that changed.
   * @param _oldValue - The previous value of the attribute.
   * @param _newValue - The new value of the attribute.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Web_Components/Using_custom_elements#lifecycle_callbacks | MDN: Lifecycle Callbacks}
   */
  attributeChangedCallback(
    _name: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _oldValue: string | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _newValue: string | null,
  ) {
    // console.log(`Attribute ${_name} has changed.`);
  }
}

customElements.define(
  "tracklist-item-custom-element",
  TracklistItemCustomElement,
);
