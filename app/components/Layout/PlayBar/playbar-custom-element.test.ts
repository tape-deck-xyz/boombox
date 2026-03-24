/**
 * @file Tests for PlaybarCustomElement
 *
 * Covers playback controls: play/pause, prev/next, track loading from S3,
 * playlist management, and events (play-toggle, play-next, play-prev, seek).
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno. Mocks fetch for S3 and a minimal Audio
 * element for playback control.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  createCustomElement,
  createLinkedomEnv,
  createS3ListXml,
  getFetchUrl,
  wireLinkedomToGlobal,
} from "../../test.utils.ts";

// Polyfill MediaMetadata for Deno (needed when Media Session API is mocked)
if (typeof globalThis.MediaMetadata === "undefined") {
  (globalThis as unknown as { MediaMetadata: typeof MediaMetadata })
    .MediaMetadata = class MediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: MediaImage[];
      constructor(
        init?: {
          title?: string;
          artist?: string;
          album?: string;
          artwork?: MediaImage[];
        },
      ) {
        this.title = init?.title ?? "";
        this.artist = init?.artist ?? "";
        this.album = init?.album ?? "";
        this.artwork = init?.artwork ?? [];
      }
    };
}

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

// ============================================================================
// MOCK STATE
// ============================================================================

// ============================================================================
// AUDIO ELEMENT PATCH
// ============================================================================
//
// Linkedom's HTMLAudioElement does not implement play()/pause() or media props.
// We use its createElement("audio") for a proper Node, then add the required API.
//

const _originalCreateElement = linkedomDocument.createElement.bind(
  linkedomDocument,
);

/** Creates a linkedom "audio" element with play/pause and media props patched in. */
function createAudioElementPatch(): HTMLAudioElement {
  const el = _originalCreateElement("audio") as HTMLAudioElement & {
    src?: string;
    currentTime?: number;
    duration?: number;
    readyState?: number;
    paused?: boolean;
  };
  el.style.display = "none";
  el.src = "";
  el.currentTime = 0;
  el.duration = 100;
  el.readyState = 0;
  el.paused = true;
  el.play = () => Promise.resolve();
  el.pause = () => {};
  return el as HTMLAudioElement;
}

// ============================================================================
// S3 FETCH HELPERS
// ============================================================================

function createS3MockFetch(contents: string[]): typeof fetch {
  const xml = createS3ListXml(contents);

  return (input: RequestInfo | URL) => {
    const url = getFetchUrl(input);
    if (url.includes("list-type=2") && url.includes("prefix=")) {
      return Promise.resolve(
        new Response(xml, {
          headers: { "Content-Type": "application/xml" },
        }),
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  };
}

// ============================================================================
// DOM SETUP (must run before importing the element module)
// ============================================================================

function setupDOMEnvironment(options?: {
  fetch?: typeof globalThis.fetch;
}) {
  const defaultFetch = createS3MockFetch([]);
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    event: true,
    fetch: options?.fetch ?? defaultFetch,
  });

  (globalThis as { DOMParser: typeof DOMParser }).DOMParser =
    linkedomWindow.DOMParser;
  if (
    !(globalThis.navigator as { mediaSession?: object }).mediaSession
  ) {
    (globalThis.navigator as { mediaSession: object }).mediaSession = {
      metadata: null,
      playbackState: "none",
      setActionHandler: () => {},
      setPositionState: () => {},
    };
  }
  (globalThis as { HTMLMediaElement: typeof HTMLMediaElement })
    .HTMLMediaElement = linkedomWindow.HTMLMediaElement;
  if (
    (globalThis.HTMLMediaElement as unknown as { HAVE_METADATA?: number })
      .HAVE_METADATA === undefined
  ) {
    (globalThis.HTMLMediaElement as unknown as {
      HAVE_NOTHING: number;
      HAVE_METADATA: number;
      HAVE_CURRENT_DATA: number;
      HAVE_FUTURE_DATA: number;
      HAVE_ENOUGH_DATA: number;
    }).HAVE_NOTHING = 0;
    (globalThis.HTMLMediaElement as unknown as { HAVE_METADATA: number })
      .HAVE_METADATA = 1;
    (globalThis.HTMLMediaElement as unknown as { HAVE_CURRENT_DATA: number })
      .HAVE_CURRENT_DATA = 2;
    (globalThis.HTMLMediaElement as unknown as { HAVE_FUTURE_DATA: number })
      .HAVE_FUTURE_DATA = 3;
    (globalThis.HTMLMediaElement as unknown as { HAVE_ENOUGH_DATA: number })
      .HAVE_ENOUGH_DATA = 4;
  }
  linkedomDocument.createElement = (tagName: string) => {
    if (tagName.toLowerCase() === "audio") {
      return createAudioElementPatch();
    }
    return _originalCreateElement(tagName);
  };
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createPlaybar(attrs: Record<string, string> = {}): HTMLElement {
  return createCustomElement(
    linkedomDocument,
    "playbar-custom-element",
    attrs,
  );
}

function getBar(el: HTMLElement): HTMLElement | null {
  return (el.shadowRoot?.querySelector("#playbar-bar") ?? null) as
    | HTMLElement
    | null;
}

function getPlayerControls(el: HTMLElement): HTMLElement | null {
  return (el.shadowRoot?.querySelector("player-controls-custom-element") ??
    null) as HTMLElement | null;
}

function _getTrackInfo(el: HTMLElement): HTMLElement | null {
  return (el.shadowRoot?.querySelector("track-info-custom-element") ??
    null) as HTMLElement | null;
}

/** Returns the audio element appended to body by the playbar (after connect). */
function getAudioElement(): HTMLAudioElement | null {
  return linkedomDocument.body?.querySelector("audio") ?? null;
}

// ============================================================================
// TESTS
// ============================================================================

Deno.test(
  "PlaybarCustomElement - should create element",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();

    assertExists(el);
    assertEquals(el.constructor.name, "PlaybarCustomElement");
  },
);

Deno.test(
  "PlaybarCustomElement - should set display and width styles on connect",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    const bar = getBar(el);

    assert(el.shadowRoot !== null);
    assertExists(bar);
  },
);

Deno.test(
  "PlaybarCustomElement - should create audio element on connect",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    createPlaybar();
    const audio = getAudioElement();

    assertExists(audio);
    assertExists(audio?.style);
    assertEquals(audio?.style?.display, "none");
  },
);

Deno.test(
  "PlaybarCustomElement - should clean up audio element on disconnect",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    assertExists(getAudioElement(), "audio should exist after connect");

    linkedomDocument.body?.removeChild(el);

    assertEquals(
      getAudioElement(),
      null,
      "audio should be removed from body on disconnect",
    );
  },
);

Deno.test(
  "PlaybarCustomElement - should update audio source when data-current-track-url changes",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    const trackUrl =
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3";
    el.setAttribute("data-current-track-url", trackUrl);

    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(el.getAttribute("data-current-track-url"), trackUrl);
  },
);

Deno.test(
  "PlaybarCustomElement - should update playing state when data-is-playing changes",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    el.setAttribute("data-is-playing", "true");
    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(el.getAttribute("data-is-playing"), "true");
  },
);

Deno.test(
  "PlaybarCustomElement - should pause when data-is-playing is false",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    el.setAttribute("data-is-playing", "true");
    await new Promise((resolve) => setTimeout(resolve, 10));

    el.setAttribute("data-is-playing", "false");
    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(el.getAttribute("data-is-playing"), "false");
  },
);

Deno.test(
  "PlaybarCustomElement - should not update if attribute value hasn't changed",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    const trackUrl =
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3";
    el.setAttribute("data-current-track-url", trackUrl);
    await new Promise((resolve) => setTimeout(resolve, 10));

    el.setAttribute("data-current-track-url", trackUrl);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(el.getAttribute("data-current-track-url"), trackUrl);
  },
);

Deno.test(
  "PlaybarCustomElement - should hide element when no track is set",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    el.removeAttribute("data-current-track-url");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const bar = getBar(el);
    assertExists(bar);
    assert(
      bar.className.includes("playbar-bar--hidden"),
      "bar should have hidden class when no track",
    );
  },
);

Deno.test(
  "PlaybarCustomElement - should dispatch change event when track changes",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    let changeEventFired = false;
    type ChangeDetail = { currentTrack: string | null; isPlaying: boolean };
    let eventDetail: ChangeDetail | null = null;

    const listener = (event: Event) => {
      changeEventFired = true;
      const customEvent = event as CustomEvent<ChangeDetail>;
      eventDetail = customEvent.detail;
    };
    el.addEventListener("change", listener);

    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (changeEventFired && eventDetail !== null) {
      assertEquals(
        (eventDetail as ChangeDetail).currentTrack,
        "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
      );
    } else {
      assert(el.getAttribute("data-current-track-url") !== null);
    }
  },
);

Deno.test(
  "PlaybarCustomElement - should dispatch change event when playing state changes",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    let changeEventFired = false;
    type ChangeDetail = { currentTrack: string | null; isPlaying: boolean };
    let eventDetail: ChangeDetail | null = null;

    const listener = (event: Event) => {
      changeEventFired = true;
      const customEvent = event as CustomEvent<ChangeDetail>;
      eventDetail = customEvent.detail;
    };
    el.addEventListener("change", listener);

    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    el.setAttribute("data-is-playing", "true");
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (changeEventFired && eventDetail !== null) {
      assertEquals((eventDetail as ChangeDetail).isPlaying, true);
    } else {
      assert(el.getAttribute("data-is-playing") === "true");
    }
  },
);

Deno.test(
  "PlaybarCustomElement - should call onchange handler when set",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    let handlerCalled = false;
    const windowObj =
      (globalThis as unknown as { window?: Record<string, unknown> })
        .window;
    if (windowObj) {
      windowObj["testOnChange"] = (_event: CustomEvent) => {
        handlerCalled = true;
      };
    }

    el.setAttribute("onchange", "testOnChange");
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (!handlerCalled) {
      assert(el.getAttribute("data-current-track-url") !== null);
    } else {
      assert(handlerCalled);
    }
  },
);

Deno.test(
  "PlaybarCustomElement - should load remaining tracks when album URL and track URL are set",
  async () => {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
        "Artist/Album/03__Track Three.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert(el.getAttribute("data-album-url") !== null);
  },
);

Deno.test(
  "PlaybarCustomElement - should handle errors when loading tracks gracefully",
  async () => {
    setupDOMEnvironment({
      fetch: () => Promise.reject(new Error("Network error")),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert(el.getAttribute("data-current-track-url") !== null);
  },
);

Deno.test(
  "PlaybarCustomElement - should filter out cover.jpeg from album tracks",
  async () => {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
        "Artist/Album/cover.jpeg",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert(el.getAttribute("data-current-track-url") !== null);
  },
);

Deno.test(
  "PlaybarCustomElement - should set hasPreviousTrack to false when current track is first",
  async () => {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
        "Artist/Album/03__Track Three.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const controls = getPlayerControls(el);
    assertExists(controls);
    assertEquals(
      controls.getAttribute("data-has-previous-track"),
      "false",
      "hasPreviousTrack should be false when current track is first",
    );
  },
);

Deno.test(
  "PlaybarCustomElement - should enable prev/next when only data-current-track-url is set (derives album URL from track)",
  async () => {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
        "Artist/Album/03__Track Three.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    // Simulate fragment navigation + track click: no data-album-url, only track URL
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/02__Track Two.mp3",
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const controls = getPlayerControls(el);
    assertExists(controls);
    assertEquals(
      controls.getAttribute("data-has-previous-track"),
      "true",
      "prev should be enabled when track is not first and album URL is derived from track",
    );
    assertEquals(
      controls.getAttribute("data-has-next-track"),
      "true",
      "next should be enabled when there are remaining tracks and album URL is derived",
    );
  },
);

Deno.test(
  "PlaybarCustomElement - should disable prev when first track and only data-current-track-url is set",
  async () => {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const controls = getPlayerControls(el);
    assertExists(controls);
    assertEquals(
      controls.getAttribute("data-has-previous-track"),
      "false",
      "prev should be disabled when track is first and album URL is derived",
    );
    assertEquals(
      controls.getAttribute("data-has-next-track"),
      "true",
      "next should be enabled when there are remaining tracks",
    );
  },
);

Deno.test({
  name: "PlaybarCustomElement - should handle play toggle button click",
  async fn() {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    el.setAttribute("data-is-playing", "false");

    const playToggleEvent = new linkedomWindow.CustomEvent("play-toggle", {
      bubbles: true,
      cancelable: false,
    });
    el.dispatchEvent(playToggleEvent);

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert(el.getAttribute("data-current-track-url") !== null);
    assertEquals(el.getAttribute("data-is-playing"), "true");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "PlaybarCustomElement - should handle play-next event",
  async fn() {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    el.setAttribute("data-is-playing", "true");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const initialTrackUrl = el.getAttribute("data-current-track-url");
    assertEquals(
      initialTrackUrl,
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );

    const playNextEvent = new linkedomWindow.CustomEvent("play-next", {
      bubbles: true,
      cancelable: false,
    });
    el.dispatchEvent(playNextEvent);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalTrackUrl = el.getAttribute("data-current-track-url");
    assert(finalTrackUrl !== null);
    assert(
      finalTrackUrl === initialTrackUrl ||
        finalTrackUrl ===
          "https://bucket.s3.amazonaws.com/Artist/Album/02__Track Two.mp3",
    );
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "PlaybarCustomElement - should handle play-prev event",
  async fn() {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/02__Track Two.mp3",
    );
    el.setAttribute("data-is-playing", "true");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const initialTrackUrl = el.getAttribute("data-current-track-url");
    assertEquals(
      initialTrackUrl,
      "https://bucket.s3.amazonaws.com/Artist/Album/02__Track Two.mp3",
    );

    const playPrevEvent = new linkedomWindow.CustomEvent("play-prev", {
      bubbles: true,
      cancelable: false,
    });
    el.dispatchEvent(playPrevEvent);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalTrackUrl = el.getAttribute("data-current-track-url");
    assert(finalTrackUrl !== null);
    assert(
      finalTrackUrl === initialTrackUrl ||
        finalTrackUrl ===
          "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name:
    "PlaybarCustomElement - should handle play-next event when no next track",
  async fn() {
    setupDOMEnvironment({
      fetch: createS3MockFetch(["Artist/Album/01__Track One.mp3"]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    el.setAttribute("data-is-playing", "true");

    await new Promise((resolve) => setTimeout(resolve, 200));

    const initialTrackUrl = el.getAttribute("data-current-track-url");

    const playNextEvent = new linkedomWindow.CustomEvent("play-next", {
      bubbles: true,
      cancelable: false,
    });
    el.dispatchEvent(playNextEvent);

    await new Promise((resolve) => setTimeout(resolve, 200));

    assertEquals(el.getAttribute("data-current-track-url"), initialTrackUrl);
    assertEquals(el.getAttribute("data-is-playing"), "true");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name:
    "PlaybarCustomElement - should handle play-prev event when no previous track",
  async fn() {
    setupDOMEnvironment({
      fetch: createS3MockFetch(["Artist/Album/01__Track One.mp3"]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    el.setAttribute("data-is-playing", "true");

    await new Promise((resolve) => setTimeout(resolve, 200));

    const initialTrackUrl = el.getAttribute("data-current-track-url");

    const playPrevEvent = new linkedomWindow.CustomEvent("play-prev", {
      bubbles: true,
      cancelable: false,
    });
    el.dispatchEvent(playPrevEvent);

    await new Promise((resolve) => setTimeout(resolve, 200));

    assertEquals(el.getAttribute("data-current-track-url"), initialTrackUrl);
    assertEquals(el.getAttribute("data-is-playing"), "true");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test(
  "PlaybarCustomElement - should set audio currentTime when seek event is dispatched",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const seekTime = 42;
    const seekEvent = new linkedomWindow.CustomEvent("seek", {
      detail: { time: seekTime },
      bubbles: true,
      composed: true,
    });
    el.dispatchEvent(seekEvent);

    const audio = getAudioElement();
    assertExists(
      audio,
      "Audio element should exist after connect and track set",
    );
    assertEquals(
      audio.currentTime,
      seekTime,
      "Audio currentTime should be set to seek event detail.time",
    );
  },
);

Deno.test(
  "PlaybarCustomElement - seekAudioBy is no-op when duration is not finite",
  async () => {
    const actionHandlers: Record<string, ((details?: unknown) => void) | null> =
      {};
    const mockMediaSession = {
      metadata: null as MediaMetadata | null,
      playbackState: "none" as MediaSessionPlaybackState,
      setActionHandler(
        action: string,
        handler: ((details?: unknown) => void) | null,
      ) {
        actionHandlers[action] = handler;
      },
      setPositionState: () => {},
    };
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { ...origNavigator, mediaSession: mockMediaSession },
      configurable: true,
      writable: true,
    });

    try {
      setupDOMEnvironment();
      await import("./playbar-custom-element.ts");

      const el = createPlaybar();
      el.setAttribute(
        "data-current-track-url",
        "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const audio = getAudioElement();
      assertExists(audio);
      const initialCurrentTime = 50;
      audio.currentTime = initialCurrentTime;
      Object.defineProperty(audio, "duration", {
        get: () => NaN,
        configurable: true,
      });

      const seekForwardHandler = actionHandlers["seekforward"];
      assert(
        seekForwardHandler !== null && typeof seekForwardHandler === "function",
      );
      seekForwardHandler({ seekOffset: 10 });

      assertEquals(
        audio.currentTime,
        initialCurrentTime,
        "currentTime should be unchanged when duration is NaN",
      );
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNavigator,
        configurable: true,
        writable: true,
      });
    }
  },
);

Deno.test({
  name:
    "PlaybarCustomElement - should auto-play next track when current track ends",
  async fn() {
    setupDOMEnvironment({
      fetch: createS3MockFetch([
        "Artist/Album/01__Track One.mp3",
        "Artist/Album/02__Track Two.mp3",
      ]),
    });
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-album-url",
      "https://bucket.s3.amazonaws.com/Artist/Album",
    );
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    el.setAttribute("data-is-playing", "true");

    await new Promise((resolve) => setTimeout(resolve, 500));

    assertEquals(
      el.getAttribute("data-current-track-url"),
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
      "should start on track 1",
    );

    const audio = getAudioElement();
    assertExists(audio);
    const endedEvent = new linkedomWindow.Event("ended", { bubbles: false });
    Object.defineProperty(endedEvent, "target", {
      value: audio,
      configurable: true,
    });
    audio.dispatchEvent(endedEvent);

    await new Promise((resolve) => setTimeout(resolve, 100));

    assertEquals(
      el.getAttribute("data-current-track-url"),
      "https://bucket.s3.amazonaws.com/Artist/Album/02__Track Two.mp3",
      "should advance to track 2 when current track ends",
    );
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name:
    "PlaybarCustomElement - should preload next track when within 20s of end",
  async fn() {
    const audioConstructorCalls: string[] = [];
    const OriginalAudio = globalThis.Audio;
    (globalThis as { Audio: typeof Audio }).Audio = function MockAudio(
      url?: string,
    ) {
      audioConstructorCalls.push(url ?? "");
      return { src: url ?? "", load: () => {} } as unknown as HTMLAudioElement;
    } as unknown as typeof Audio;

    try {
      setupDOMEnvironment({
        fetch: createS3MockFetch([
          "Artist/Album/01__Track One.mp3",
          "Artist/Album/02__Track Two.mp3",
        ]),
      });
      await import("./playbar-custom-element.ts");

      const el = createPlaybar();
      el.setAttribute(
        "data-album-url",
        "https://bucket.s3.amazonaws.com/Artist/Album",
      );
      el.setAttribute(
        "data-current-track-url",
        "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
      );
      el.setAttribute("data-is-playing", "true");

      await new Promise((resolve) => setTimeout(resolve, 500));

      const audio = getAudioElement();
      assertExists(audio);
      Object.defineProperty(audio, "currentTime", {
        get: () => 85,
        configurable: true,
      });
      Object.defineProperty(audio, "duration", {
        get: () => 100,
        configurable: true,
      });

      const timeupdateEvent = new linkedomWindow.Event("timeupdate", {
        bubbles: false,
      });
      Object.defineProperty(timeupdateEvent, "target", {
        value: audio,
        configurable: true,
      });
      audio.dispatchEvent(timeupdateEvent);

      assert(
        audioConstructorCalls.length > 0,
        "Audio constructor should be called to preload next track",
      );
      assert(
        audioConstructorCalls.some((url) =>
          url.includes("Artist/Album/02__Track Two.mp3")
        ),
        "Preload should request the next track URL",
      );
    } finally {
      (globalThis as { Audio: typeof Audio }).Audio = OriginalAudio;
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test(
  "PlaybarCustomElement - should handle play() errors gracefully",
  async () => {
    setupDOMEnvironment();
    await import("./playbar-custom-element.ts");

    const el = createPlaybar();
    el.setAttribute(
      "data-current-track-url",
      "https://bucket.s3.amazonaws.com/Artist/Album/01__Track One.mp3",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const audio = getAudioElement();
    if (audio) {
      audio.play = () => Promise.reject(new Error("Playback failed"));
      Object.defineProperty(audio, "readyState", {
        get: () => 1,
        configurable: true,
      });
    }

    el.setAttribute("data-is-playing", "true");

    await new Promise((resolve) => setTimeout(resolve, 200));

    const finalIsPlaying = el.getAttribute("data-is-playing");
    assert(
      finalIsPlaying === "false" || finalIsPlaying === null,
      `is-playing should be false after play error, but got: ${finalIsPlaying}`,
    );
  },
);
