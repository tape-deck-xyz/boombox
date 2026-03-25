/** @file Custom element for player controls seen at the bottom of the screen */

import { getCoverArtUrlForAlbum } from "../../../util/info-client.ts";
import {
  getAllAlbumTracks,
  getParentDataFromTrackUrl,
  getRemainingAlbumTracks,
} from "../../../util/track.ts";
import { deriveTrackMetadata } from "../../../util/track-metadata.ts";
import {
  type MediaSessionCallbacks,
  MediaSessionController,
  type MediaSessionMetadata,
} from "../../../util/media-session.ts";
import "../../../icons/play/index.ts";
import "../../../icons/pause/index.ts";
import "../../../icons/prev/index.ts";
import "../../../icons/next/index.ts";
import "../../../icons/playlist/index.ts";
import "./player-controls-custom-element.ts";
import "./progress-indicator-custom-element.ts";

/** playlist-custom-element is intentionally not imported here or in register-custom-elements.
 * It is not used in the current playbar UI; if the playlist dropdown is re-added, import
 * playlist-custom-element.ts so the element is defined before use. */

/**
 * Template for the playbar. Styles are encapsulated in the shadow root.
 * Variables are set on :host so they inherit to child custom elements
 * (track-info, player-controls, progress-indicator) and their shadow roots.
 * Breakpoints: default (mobile), 50rem (sm), 64rem (md).
 */
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: block;
      width: 100%;
      --playbar-height: 4rem;
      --playbar-padding: 0.5rem;
      --playbar-album-size: 48px;
      --playbar-control-size: 2rem;
      --playbar-controls-width: 7rem;
      --playbar-gap: 0.5rem;
    }
    @media only screen and (min-width: 50rem) {
      :host {
        --playbar-height: 5rem;
        --playbar-padding: 0.75rem;
        --playbar-album-size: 64px;
        --playbar-control-size: 2.25rem;
        --playbar-controls-width: 8.5rem;
        --playbar-gap: 0.75rem;
      }
    }
    @media only screen and (min-width: 64rem) {
      :host {
        --playbar-height: 6rem;
        --playbar-padding: 0;
        --playbar-album-size: 96px;
        --playbar-control-size: 2.5rem;
        --playbar-controls-width: 10rem;
        --playbar-gap: 1rem;
      }
    }
    .playbar-bar {
      position: fixed;
      bottom: 0;
      box-sizing: border-box;
      left: 0;
      right: 0;
      width: 100%;
      height: var(--playbar-height);
      padding: var(--playbar-padding);
      min-height: var(--playbar-height);
      max-height: var(--playbar-height);
      background-color: black;
      z-index: 10;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      transition: transform 0.2s ease;
    }
    .playbar-bar-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex: 1 1 0%;
      min-height: 0;
    }
    .playbar-bar--hidden {
      transform: translateY(100%);
    }
    .playbar-track-area {
      flex: 1 1 0%;
      min-width: 0;
      max-width: calc(100% - var(--playbar-controls-width));
      overflow-x: clip;
      display: flex;
      align-items: center;
      flex-basis: 60%;
    }
    .playbar-controls-wrap {
      height: 100%;
      flex-shrink: 0;
    }
    .playbar-progress-wrap {
      flex: 0 0 auto;
      width: 100%;
      /* 6px so progress bar hover state (6px) isn't clipped */
      height: 6px;
      display: none;
    }
    @media only screen and (min-width: 64rem) {
      .playbar-controls-wrap {
        padding-right: 1rem;
      }
      .playbar-progress-wrap {
        display: flex;
      }
      .playbar-track-area {
        flex-basis: 20%;
      }
    }
  </style>
  <div id="playbar-bar" class="playbar-bar">
    <div class="playbar-progress-wrap">
      <progress-indicator-custom-element data-current-time="0" data-duration="0"></progress-indicator-custom-element>
    </div>
    <div class="playbar-bar-inner">
      <div class="playbar-track-area">
        <track-info-custom-element data-track-url=""></track-info-custom-element>
      </div>
      <div class="playbar-controls-wrap">
        <player-controls-custom-element data-play-state="paused" data-has-previous-track="false" data-has-next-track="false"></player-controls-custom-element>
      </div>
    </div>
  </div>
`;

/**
 * Custom element for player controls displayed at the bottom of the screen.
 * This element is self-contained and manages all player logic internally.
 *
 * The element is controlled entirely through HTML attributes. User interactions
 * (play/pause/next buttons, playlist selection) are handled internally. External
 * code can control playback by setting attributes and react to state changes via
 * the `change` event or `onchange` attribute.
 *
 * @customElement playbar-custom-element
 *
 * @example
 * ```html
 * <playbar-custom-element
 *   data-album-url="https://bucket.s3.amazonaws.com"
 *   data-current-track-url="https://bucket.s3.amazonaws.com/artist/album/01__Track Name.mp3"
 *   data-is-playing="true"
 *   onchange="handlePlayerChange">
 * </playbar-custom-element>
 * ```
 *
 * @example
 * ```javascript
 * const playbar = document.querySelector('playbar-custom-element');
 *
 * // Listen for state change events
 * playbar.addEventListener('change', (event) => {
 *   console.log('Player state changed:', {
 *     currentTrack: event.detail.currentTrack,
 *     isPlaying: event.detail.isPlaying
 *   });
 * });
 *
 * // Control playback by setting attributes
 * playbar.setAttribute('data-current-track-url', 'https://.../track.mp3');
 * playbar.setAttribute('data-is-playing', 'true');
 *
 * // To pause, set is-playing to false
 * playbar.setAttribute('data-is-playing', 'false');
 *
 * // To stop, remove the current track URL
 * playbar.removeAttribute('data-current-track-url');
 * ```
 *
 * @attributes
 * - `data-current-track-url` (string | null): Current track URL.
 *   Expected format: `{baseUrl}/{artistName}/{albumName}/{trackNumber}__{trackName}.{ext}`
 *   Setting this attribute will load and optionally play the track (if `data-is-playing` is "true").
 *   Removing this attribute will stop playback.
 *
 * - `data-is-playing` (string): Playing state. Must be the string "true" or "false".
 *   Controls whether the current track is playing or paused.
 *
 * - `data-album-url` (string | null): The base URL for the album (S3 bucket URL).
 *   Used to fetch remaining tracks for prev/next buttons and the playlist dropdown.
 *   Optional: when omitted, the album URL is derived from `data-current-track-url`
 *   (e.g. after fragment navigation when the playbar has no album context).
 *
 * - `onchange` (string): Optional function name to call when player state changes.
 *   The function will be called with a CustomEvent as the argument.
 *   Alternatively, listen to the 'change' event using addEventListener.
 *
 * @events
 * - `change` (CustomEvent): Dispatched when player state changes (track or playing state).
 *   This event is fired whenever the current track or playing state changes, whether
 *   due to user interaction or attribute changes.
 *   - `detail.currentTrack` (string | null): Current track URL
 *   - `detail.isPlaying` (boolean): Whether currently playing
 *   - `bubbles`: true
 *   - `cancelable`: false
 *
 * @remarks
 * The element automatically:
 * - Manages its own audio element and playback state internally
 * - Handles all user interactions (play/pause/next buttons, playlist clicks, progress scrubber)
 * - Listens for `seek` events from the embedded progress-indicator and sets audio currentTime
 * - Loads remaining tracks in the album when `data-current-track-url` is set
 *   (uses `data-album-url` when provided, otherwise derives it from the track URL)
 * - Preloads the next track when within 20 seconds of the end
 * - Auto-plays the next track when the current track ends
 * - Parses track information from the URL format: `{number}__{name}.{ext}`
 * - Updates the UI when attributes change (including progress bar on timeupdate)
 * - Hides itself when no track is set (using `translate-y-full` class)
 * - Integrates with the Media Session API for lock screen / notification controls
 *   (play, pause, next, previous, seek), using ID3 tags and album cover from track URL
 *
 * All player logic is self-contained within this element. External code should
 * control playback by setting attributes, not by calling methods.
 */
export class PlaybarCustomElement extends HTMLElement {
  static observedAttributes = [
    "data-current-track-url",
    "data-is-playing",
    "data-album-url",
    "onchange",
  ];

  private currentTrackUrl: string | null = null;
  private isPlaying: boolean = false;
  private albumUrl: string | null = null;
  private nextTrackLoaded: boolean = false;
  private remainingTracks: Array<{
    url: string;
    title: string;
    trackNum: number;
  }> = [];
  private allAlbumTracks: Array<{
    url: string;
    title: string;
    trackNum: number;
  }> = [];
  private loadTracksPromise: Promise<void> | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private boundTimeUpdate: (event: Event) => void;
  private boundEnded: (event: Event) => void;
  private boundHandlePlayToggle: (event: Event) => void;
  private boundHandlePlayNext: (event: Event) => void;
  private boundHandlePlayPrev: (event: Event) => void;
  private boundHandleSeek: (event: Event) => void;
  private mediaSession: MediaSessionController | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
    // Use event delegation to avoid memory leaks
    // Store bound function so we can remove it later
    this.boundTimeUpdate = this.handleTimeUpdate.bind(this);
    this.boundEnded = this.handleEnded.bind(this);
    this.boundHandlePlayToggle = this.handlePlayToggle.bind(this);
    this.boundHandlePlayNext = this.handlePlayNext.bind(this);
    this.boundHandlePlayPrev = this.handlePlayPrev.bind(this);
    this.boundHandleSeek = this.handleSeek.bind(this);
  }

  connectedCallback() {
    this.createAudioElement();
    this.mediaSession = new MediaSessionController(
      this.createMediaSessionCallbacks(),
    );
    this.updateAttributes();
    this.render();
    // Listen for play-toggle event from player-controls-custom-element
    this.addEventListener("play-toggle", this.boundHandlePlayToggle);
    // Listen for play-next event from player-controls-custom-element
    this.addEventListener("play-next", this.boundHandlePlayNext);
    // Listen for play-prev event from player-controls-custom-element
    this.addEventListener("play-prev", this.boundHandlePlayPrev);
    this.addEventListener("seek", this.boundHandleSeek);
  }

  disconnectedCallback() {
    this.mediaSession?.destroy();
    this.mediaSession = null;
    // Remove event listeners on disconnect
    this.removeEventListener("play-toggle", this.boundHandlePlayToggle);
    this.removeEventListener("play-next", this.boundHandlePlayNext);
    this.removeEventListener("play-prev", this.boundHandlePlayPrev);
    this.removeEventListener("seek", this.boundHandleSeek);
    if (this.audioElement) {
      this.audioElement.removeEventListener("timeupdate", this.boundTimeUpdate);
      this.audioElement.removeEventListener("ended", this.boundEnded);
      this.audioElement.pause();
      this.audioElement.src = "";
      // Remove audio element from DOM if we added it
      if (this.audioElement.parentNode) {
        this.audioElement.parentNode.removeChild(this.audioElement);
      }
      this.audioElement = null;
    }
  }

  async attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ) {
    if (name === "data-current-track-url") {
      // Only update if different to avoid unnecessary re-renders
      if (this.currentTrackUrl !== _newValue) {
        // Cancel any existing load promise since we're changing tracks
        if (this.loadTracksPromise) {
          this.loadTracksPromise = null;
        }
        this.currentTrackUrl = _newValue;
        this.updateAudioSource();
        // Render immediately with current state, then update when tracks load
        this.render();
        await this.loadRemainingTracks();
        // loadRemainingTracks will call render() after tracks are loaded
        this.dispatchChangeEvent();
      }
    } else if (name === "data-is-playing") {
      const newIsPlaying = _newValue === "true";
      if (this.isPlaying !== newIsPlaying) {
        this.isPlaying = newIsPlaying;
        this.updateAudioPlayback();
        this.dispatchChangeEvent();
        this.render();
      }
    } else if (name === "data-album-url") {
      if (this.albumUrl !== _newValue) {
        // Cancel any existing load promise since we're changing albums
        if (this.loadTracksPromise) {
          this.loadTracksPromise = null;
        }
        this.albumUrl = _newValue;
        // Render immediately, then update when tracks load
        this.render();
        await this.loadRemainingTracks();
        // loadRemainingTracks will call render() after tracks are loaded
      }
    } else {
      // For other attributes, just render
      this.render();
    }
  }

  private async updateAttributes() {
    this.currentTrackUrl = this.getAttribute("data-current-track-url");
    this.isPlaying = this.getAttribute("data-is-playing") === "true";
    this.albumUrl = this.getAttribute("data-album-url");
    await this.loadRemainingTracks();
  }

  private createAudioElement() {
    // Create audio element if it doesn't exist
    if (!this.audioElement) {
      this.audioElement = document.createElement("audio");
      this.audioElement.addEventListener("timeupdate", this.boundTimeUpdate);
      this.audioElement.addEventListener("ended", this.boundEnded);
      // Hide the audio element (it's just for playback, not display)
      this.audioElement.style.display = "none";
      document.body.appendChild(this.audioElement);
      this.updateAudioSource();
      this.updateAudioPlayback();
    }
  }

  private createMediaSessionCallbacks(): MediaSessionCallbacks {
    return {
      onPlay: () => this.playToggle(this.currentTrackUrl ?? undefined),
      onPause: () => this.pause(),
      onStop: () => this.playToggle(),
      onNextTrack: () => this.playNext(),
      onPreviousTrack: () => this.playPrev(),
      onSeekBackward: (d) => this.seekAudioBy(-d.seekOffset),
      onSeekForward: (d) => this.seekAudioBy(d.seekOffset),
      onSeekTo: (d) => {
        if (this.audioElement) {
          this.audioElement.currentTime = d.seekTime;
        }
      },
    };
  }

  private updateAudioSource() {
    if (!this.audioElement) return;

    if (this.currentTrackUrl) {
      this.audioElement.src = this.currentTrackUrl;
      this.nextTrackLoaded = false;
      this.updateMediaSessionFromTrack(this.currentTrackUrl);
      // After setting source, update playback state when metadata is loaded
      const handleLoadedMetadata = () => {
        // Check current playing state, not the captured one
        if (this.isPlaying) {
          this.updateAudioPlayback();
        }
      };
      this.audioElement.addEventListener(
        "loadedmetadata",
        handleLoadedMetadata,
        { once: true },
      );
      // If metadata is already loaded, update playback immediately
      if (this.audioElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
        handleLoadedMetadata();
      }
    } else {
      this.audioElement.src = "";
      this.audioElement.pause();
      this.mediaSession?.updateMetadata(null);
      this.mediaSession?.updatePlaybackState("none");
    }
  }

  /**
   * Derives metadata from track URL and updates Media Session metadata.
   * Used for lock screen / notification controls (title, artist, album, artwork).
   * Guards against race where the user switches tracks before the fetch completes.
   */
  private async updateMediaSessionFromTrack(trackUrl: string): Promise<void> {
    const derivedMetadata = await deriveTrackMetadata(trackUrl);
    if (this.currentTrackUrl !== trackUrl) return;

    let coverFromInfo: string | null = null;
    try {
      const data = getParentDataFromTrackUrl(trackUrl);
      if (data.artistName && data.albumName) {
        coverFromInfo = await getCoverArtUrlForAlbum(
          data.artistName,
          data.albumName,
        );
      }
    } catch {
      // Invalid URL format or /info unavailable
    }
    if (this.currentTrackUrl !== trackUrl) return;

    const metadata: MediaSessionMetadata = {
      title: derivedMetadata.title,
      artist: derivedMetadata.artist,
      album: derivedMetadata.album,
      artworkUrl: derivedMetadata.image ?? coverFromInfo ?? undefined,
    };
    this.mediaSession?.updateMetadata(metadata);
  }

  /**
   * Seeks the audio element by deltaSeconds (positive = forward, negative = backward).
   * Clamps to [0, duration]. No-ops if no audio element or duration is not yet finite.
   */
  private seekAudioBy(deltaSeconds: number): void {
    if (!this.audioElement) return;
    const duration = this.audioElement.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.audioElement.currentTime = Math.max(
      0,
      Math.min(duration, this.audioElement.currentTime + deltaSeconds),
    );
  }

  private updateAudioPlayback() {
    if (!this.audioElement || !this.audioElement.src) return;

    if (this.isPlaying && this.currentTrackUrl) {
      this.mediaSession?.updatePlaybackState("playing");
      this.audioElement.play().catch((error) => {
        console.error("Failed to play audio:", error);
        this.isPlaying = false;
        this.setAttribute("data-is-playing", "false");
        this.dispatchChangeEvent();
      });
      this.nextTrackLoaded = false;
    } else {
      this.mediaSession?.updatePlaybackState(
        this.currentTrackUrl ? "paused" : "none",
      );
      this.audioElement.pause();
    }
  }

  private handleTimeUpdate(event: Event) {
    const audio = event.target as HTMLAudioElement;
    this.updateProgressIndicator(audio);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      this.mediaSession?.updatePositionState(
        audio.currentTime,
        audio.duration,
        1,
      );
    }
    if (
      !this.nextTrackLoaded &&
      !Number.isNaN(audio.duration) &&
      // If we're within 20s of the end of the track
      audio.duration - 20 < audio.currentTime &&
      this.currentTrackUrl
    ) {
      this.nextTrackLoaded = true;
      const [nextTrack] = this.remainingTracks;
      if (nextTrack) {
        // Preload the next track
        new Audio(nextTrack.url);
      }
    }
  }

  /**
   * Updates the progress indicator element with current time and duration.
   */
  private updateProgressIndicator(audio: HTMLAudioElement) {
    const progress = this.shadowRoot?.querySelector(
      "progress-indicator-custom-element",
    );
    if (!progress) return;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const duration =
      Number.isFinite(audio.duration) && !Number.isNaN(audio.duration)
        ? audio.duration
        : 0;
    progress.setAttribute("data-current-time", String(current));
    progress.setAttribute("data-duration", String(duration));
  }

  /**
   * Handles the seek event from progress-indicator-custom-element.
   * Sets the audio element's currentTime to the requested position.
   */
  private handleSeek(event: Event) {
    const seekEvent = event as CustomEvent<{ time: number }>;
    const time = seekEvent.detail?.time;
    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      time < 0 ||
      !this.audioElement
    ) {
      return;
    }
    this.audioElement.currentTime = time;
  }

  private handleEnded() {
    this.playNext();
  }

  /**
   * Handles the play-toggle event from player-controls-custom-element.
   * Toggles play/pause for the current track, or stops playback if no track is set.
   *
   * @private
   * @param event - The play-toggle custom event
   */
  private async handlePlayToggle(event: Event) {
    event.stopPropagation();
    // Toggle play/pause for the current track
    await this.playToggle(
      this.getAttribute("data-current-track-url") || undefined,
    );

    this.render();
  }

  /**
   * Handles the play-next event from player-controls-custom-element.
   * Plays the next track in the album if available.
   *
   * @private
   * @param event - The play-next custom event
   */
  private handlePlayNext(event: Event) {
    event.stopPropagation();
    this.playNext();
    this.render();
  }

  /**
   * Handles the play-prev event from player-controls-custom-element.
   * Plays the previous track in the album if available.
   *
   * @private
   * @param event - The play-prev custom event
   */
  private handlePlayPrev(event: Event) {
    event.stopPropagation();
    this.playPrev();
    this.render();
  }

  private async loadRemainingTracks() {
    // If already loading, wait for it with a timeout
    if (this.loadTracksPromise) {
      try {
        await Promise.race([
          this.loadTracksPromise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Load timeout after 10 seconds")),
              10000,
            )
          ),
        ]);
      } catch (error) {
        console.error(
          "loadRemainingTracks: Previous load failed or timed out:",
          error,
        );
        // Reset the promise so we can try again
        this.loadTracksPromise = null;
      }
      return;
    }

    this.loadTracksPromise = (async () => {
      let effectiveAlbumUrl = this.albumUrl;
      if (!effectiveAlbumUrl && this.currentTrackUrl) {
        try {
          effectiveAlbumUrl = getParentDataFromTrackUrl(
            this.currentTrackUrl,
          ).albumUrl;
        } catch {
          effectiveAlbumUrl = null;
        }
      }
      try {
        if (effectiveAlbumUrl && this.currentTrackUrl) {
          this.remainingTracks = await getRemainingAlbumTracks(
            effectiveAlbumUrl,
            this.currentTrackUrl,
          );
          await this.loadAllAlbumTracks(effectiveAlbumUrl);
          this.render();
        } else {
          this.remainingTracks = [];
          this.allAlbumTracks = [];
        }
      } catch (error) {
        console.error("Failed to load remaining tracks:", error);
        this.remainingTracks = [];
        this.allAlbumTracks = [];
      } finally {
        this.loadTracksPromise = null;
      }
    })();

    return this.loadTracksPromise;
  }

  /**
   * Load all tracks in the album for prev button functionality.
   * Filters out cover.jpeg files from the track list.
   * @param albumUrlOverride - Optional. When set, used instead of this.albumUrl (e.g. when derived from track URL).
   */
  private async loadAllAlbumTracks(albumUrlOverride?: string | null) {
    const albumUrl = albumUrlOverride ?? this.albumUrl;
    if (!albumUrl || !this.currentTrackUrl) {
      this.allAlbumTracks = [];
      return;
    }
    this.allAlbumTracks =
      (await getAllAlbumTracks(albumUrl, this.currentTrackUrl)).filter((
        track,
      ) => track.title !== "cover.jpeg");
  }

  /**
   * Play/Pause/Resume/Stop
   * There are 4 different scenarios this supports:
   * 1. If a track is passed in that is not currently being played, it will start playing that track
   * 2. If a track is passed in that is currently being played, it will pause
   * 3. If a track is passed in that is the current track, but it's not currently playing, it will resume
   * 4. If no track is passed in, it will stop playback
   */
  private async playToggle(trackUrl?: string) {
    if (trackUrl) {
      if (trackUrl !== this.currentTrackUrl) {
        this.currentTrackUrl = trackUrl;
        this.setAttribute("data-current-track-url", trackUrl);
        this.isPlaying = true;
        this.setAttribute("data-is-playing", "true");
        this.updateAudioSource();
        this.updateAudioPlayback();
        await this.loadRemainingTracks();
        this.dispatchChangeEvent();
      } else if (this.isPlaying) {
        this.pause();
      } else {
        // Same track, not playing - resume it
        this.isPlaying = true;
        this.setAttribute("data-is-playing", "true");
        this.updateAudioPlayback();
        this.dispatchChangeEvent();
      }
    } else {
      // No track URL - stop playback
      this.currentTrackUrl = null;
      this.removeAttribute("data-current-track-url");
      this.pause();
    }
  }

  /** Pause track */
  private pause() {
    this.isPlaying = false;
    this.setAttribute("data-is-playing", "false");
    this.updateAudioPlayback();
    this.dispatchChangeEvent();
  }

  /** Play next track */
  private playNext() {
    if (this.currentTrackUrl && this.remainingTracks.length > 0) {
      const [nextTrack] = this.remainingTracks;
      if (nextTrack) {
        this.playToggle(nextTrack.url);
      }
    }
  }

  /** Play previous track */
  private playPrev() {
    if (!this.currentTrackUrl || this.allAlbumTracks.length === 0) {
      return;
    }

    const currentTrackPieces = this.currentTrackUrl.split("/");
    const currentTrackKey = currentTrackPieces[currentTrackPieces.length - 1];
    const currentTrackIndex = this.allAlbumTracks.findIndex((track) => {
      const trackPieces = track.url.split("/");
      const trackKey = trackPieces[trackPieces.length - 1];
      return trackKey === currentTrackKey;
    });

    if (currentTrackIndex > 0) {
      const prevTrack = this.allAlbumTracks[currentTrackIndex - 1];
      if (prevTrack) {
        this.playToggle(prevTrack.url);
      }
    }
  }

  /**
   * Dispatches a `change` event when player state changes.
   * Also calls the onchange attribute handler if set.
   * @fires change
   */
  private dispatchChangeEvent() {
    const event = new CustomEvent("change", {
      detail: {
        currentTrack: this.currentTrackUrl,
        isPlaying: this.isPlaying,
      },
      bubbles: true,
      cancelable: false,
    });
    this.dispatchEvent(event);

    // Call onchange attribute handler if set
    const onchangeHandler = this.getAttribute("onchange");
    if (onchangeHandler) {
      try {
        // Try to call as a function name on window
        const handler =
          (window as unknown as Record<string, unknown>)[onchangeHandler];
        if (typeof handler === "function") {
          handler(event);
        }
      } catch (error) {
        console.warn("Failed to call onchange handler:", error);
      }
    }
  }

  private render() {
    const bar = this.shadowRoot?.querySelector("#playbar-bar");
    const trackInfo = this.shadowRoot?.querySelector(
      "track-info-custom-element",
    );
    const playerControls = this.shadowRoot?.querySelector(
      "player-controls-custom-element",
    );
    const progress = this.shadowRoot?.querySelector(
      "progress-indicator-custom-element",
    );
    if (!bar || !trackInfo || !playerControls) return;

    bar.className = this.currentTrackUrl
      ? "playbar-bar"
      : "playbar-bar playbar-bar--hidden";

    trackInfo.setAttribute(
      "data-track-url",
      this.currentTrackUrl ?? "",
    );
    playerControls.setAttribute(
      "data-play-state",
      this.isPlaying ? "playing" : "paused",
    );
    playerControls.setAttribute(
      "data-has-previous-track",
      this.hasPreviousTrack() ? "true" : "false",
    );
    playerControls.setAttribute(
      "data-has-next-track",
      this.remainingTracks.length > 0 ? "true" : "false",
    );

    if (progress) {
      if (this.audioElement?.src) {
        this.updateProgressIndicator(this.audioElement);
      } else {
        progress.setAttribute("data-current-time", "0");
        progress.setAttribute("data-duration", "0");
      }
    }
  }

  /**
   * Whether there is a previous track (matching playPrev() logic).
   */
  private hasPreviousTrack(): boolean {
    if (!this.currentTrackUrl || this.allAlbumTracks.length === 0) {
      return false;
    }
    const currentTrackPieces = this.currentTrackUrl.split("/");
    const currentTrackKey = currentTrackPieces[currentTrackPieces.length - 1];
    const currentTrackIndex = this.allAlbumTracks.findIndex((track) => {
      const trackPieces = track.url.split("/");
      const trackKey = trackPieces[trackPieces.length - 1];
      return trackKey === currentTrackKey;
    });
    return currentTrackIndex > 0;
  }
}

customElements.define(
  "playbar-custom-element",
  PlaybarCustomElement,
);
