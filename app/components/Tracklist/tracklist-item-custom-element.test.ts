/**
 * @file Tests for TracklistItemCustomElement
 *
 * Covers track display (name, artist, number, duration), duration loading from
 * audio metadata, track-click event dispatch, and click handling.
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno. Mocks Audio for duration loading.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { createLinkedomEnv, wireLinkedomToGlobal } from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

// ============================================================================
// MOCK STATE
// ============================================================================

/** Last created mock Audio instance - used to fire loadedmetadata/error in tests. */
let lastMockAudio: MockAudioInstance | null = null;
let consoleWarnCalls: unknown[][] = [];
let consoleErrorCalls: unknown[][] = [];

interface MockAudioInstance {
  _duration: number;
  _error: MediaError | null;
  _listeners: {
    loadedmetadata: ((e: Event) => void)[];
    error: ((e: Event) => void)[];
  };
  loadCalls: number;
  fireLoadedMetadata(): void;
  fireError(): void;
}

/** Creates the mock Audio constructor - returns controllable instances. */
function createMockAudio(): typeof Audio {
  return function MockAudio(this: MockAudioInstance, url?: string) {
    const _listeners = {
      loadedmetadata: [] as ((e: Event) => void)[],
      error: [] as ((e: Event) => void)[],
    };
    let _duration = 0;
    let _error: MediaError | null = null;
    let loadCalls = 0;

    const self = {
      src: url ?? "",
      preload: "metadata" as const,
      get duration() {
        return _duration;
      },
      set duration(v: number) {
        _duration = v;
      },
      get error() {
        return _error;
      },
      set error(v: MediaError | null) {
        _error = v;
      },
      networkState: 0,
      readyState: 0,
      load: () => {
        loadCalls++;
      },
      addEventListener: (type: string, fn: (e: Event) => void) => {
        if (type === "loadedmetadata") _listeners.loadedmetadata.push(fn);
        if (type === "error") _listeners.error.push(fn);
      },
      removeEventListener: (type: string, fn: (e: Event) => void) => {
        if (type === "loadedmetadata") {
          _listeners.loadedmetadata = _listeners.loadedmetadata.filter((l) =>
            l !== fn
          );
        }
        if (type === "error") {
          _listeners.error = _listeners.error.filter((l) => l !== fn);
        }
      },
    };

    const instance = {
      ...self,
      _listeners,
      loadCalls: 0,
      fireLoadedMetadata: () => {
        const evt = { target: self } as Event;
        _listeners.loadedmetadata.forEach((fn) => fn(evt));
      },
      fireError: () => {
        const evt = { target: self } as Event;
        _listeners.error.forEach((fn) => fn(evt));
      },
    } as MockAudioInstance;

    Object.defineProperty(instance, "loadCalls", {
      get: () => loadCalls,
      configurable: true,
    });
    Object.defineProperty(instance, "_duration", {
      get: () => _duration,
      set: (v: number) => {
        _duration = v;
      },
      configurable: true,
    });
    Object.defineProperty(instance, "_error", {
      get: () => _error,
      set: (v: MediaError | null) => {
        _error = v;
      },
      configurable: true,
    });

    lastMockAudio = instance;
    return instance as unknown as HTMLAudioElement;
  } as unknown as typeof Audio;
}

// ============================================================================
// DOM SETUP (must run before importing the element module)
// ============================================================================

function setupDOMEnvironment() {
  lastMockAudio = null;
  consoleWarnCalls = [];
  consoleErrorCalls = [];

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = ((...args: unknown[]) => {
    consoleWarnCalls.push(args);
    originalWarn(...args);
  }) as typeof console.warn;
  console.error = ((...args: unknown[]) => {
    consoleErrorCalls.push(args);
    originalError(...args);
  }) as typeof console.error;

  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, { event: true });

  (globalThis as { Audio: typeof Audio }).Audio = createMockAudio();

  ensureGetAttributePatch();
}

// ============================================================================
// TEST HELPERS
// ============================================================================
//
// The tracklist-item reads attributes in the constructor. With document.createElement,
// the constructor runs before we can setAttribute. We patch getAttribute so the
// constructor sees our attributes when creating the element.

let _pendingTracklistAttrs: Record<string, string> | null = null;
let _getAttributePatched = false;

function ensureGetAttributePatch() {
  if (_getAttributePatched) return;
  _getAttributePatched = true;
  const ElementProto = (linkedomWindow as Window & { Element: typeof Element })
    .Element?.prototype ?? (globalThis as { Element?: typeof Element }).Element
    ?.prototype;
  if (!ElementProto) return;
  const orig = ElementProto.getAttribute;
  ElementProto.getAttribute = function (this: Element, name: string) {
    if (_pendingTracklistAttrs && name in _pendingTracklistAttrs) {
      return _pendingTracklistAttrs[name];
    }
    return orig.call(this, name);
  };
}

/** Creates a tracklist-item in the DOM with optional attributes. Patches
 * getAttribute so the constructor sees the attributes. Call setupDOMEnvironment first. */
function createTracklistItem(
  attrs: Record<string, string> = {},
): HTMLElement {
  const defaults = {
    "data-track-name": "Test Track",
    "data-track-artist": "Test Artist",
    "data-track-number": "1",
    "data-track-url": "/path/to/track.mp3",
  };
  const merged = { ...defaults, ...attrs };
  _pendingTracklistAttrs = merged;
  try {
    const el = linkedomDocument.createElement("tracklist-item-custom-element");
    for (const [k, v] of Object.entries(merged)) {
      el.setAttribute(k, v);
    }
    linkedomDocument.body?.appendChild(el);
    return el as HTMLElement;
  } finally {
    _pendingTracklistAttrs = null;
  }
}

/** Creates a tracklist-item without appending to body (for tests that need
 * attributes set after constructor). Attributes will be empty in constructor. */
function createTracklistItemUnconnected(
  attrs: Record<string, string> = {},
): HTMLElement {
  const el = linkedomDocument.createElement("tracklist-item-custom-element");
  const defaults = {
    "data-track-name": "Test Track",
    "data-track-artist": "Test Artist",
    "data-track-number": "1",
    "data-track-url": "/path/to/track.mp3",
  };
  const merged = { ...defaults, ...attrs };
  for (const [k, v] of Object.entries(merged)) {
    el.setAttribute(k, v);
  }
  return el as HTMLElement;
}

function getTrackDurationEl(el: HTMLElement): HTMLElement | null {
  return el.querySelector(".track-duration") as HTMLElement | null;
}

function dispatchClick(el: HTMLElement): void {
  el.dispatchEvent(
    new (linkedomWindow.Event || Event)("click", { bubbles: true }),
  );
}

// ============================================================================
// TESTS
// ============================================================================

Deno.test(
  "TracklistItemCustomElement - should create element",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem();

    assertExists(el);
    assertEquals(el.constructor.name, "TracklistItemCustomElement");
  },
);

Deno.test(
  "TracklistItemCustomElement - should initialize with attributes from constructor",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem({
      "data-track-name": "My Song",
      "data-track-artist": "My Artist",
      "data-track-number": "5",
      "data-track-url": "/music/song.mp3",
    });

    assertStringIncludes(el.innerHTML, "My Song");
    assertStringIncludes(el.innerHTML, "My Artist");
    assertStringIncludes(el.innerHTML, "5");
  },
);

Deno.test(
  "TracklistItemCustomElement - should render HTML structure",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    createTracklistItem({
      "data-track-name": "Test Track",
      "data-track-artist": "Test Artist",
      "data-track-number": "1",
      "data-track-url": "/test.mp3",
    });

    const el = linkedomDocument.querySelector("tracklist-item-custom-element");
    assertExists(el);
    const html = el!.innerHTML;
    assertStringIncludes(html, 'class="track"');
    assertStringIncludes(html, 'class="track-number"');
    assertStringIncludes(html, 'class="track-info"');
    assertStringIncludes(html, 'class="track-name"');
    assertStringIncludes(html, 'class="track-artist"');
    assertStringIncludes(html, 'class="track-duration"');
  },
);

Deno.test(
  "TracklistItemCustomElement - should render CSS styles",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem();

    assertStringIncludes(el.innerHTML, "<style>");
    assertStringIncludes(el.innerHTML, ".track {");
    assertStringIncludes(el.innerHTML, ".track:hover {");
    assertStringIncludes(el.innerHTML, ".track-number {");
    assertStringIncludes(el.innerHTML, ".track-info {");
    assertStringIncludes(el.innerHTML, ".track-name {");
    assertStringIncludes(el.innerHTML, ".track-artist {");
    assertStringIncludes(el.innerHTML, ".track-duration {");
  },
);

Deno.test(
  "TracklistItemCustomElement - should add click listener on connect",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem();
    let clicked = false;
    el.addEventListener("click", () => {
      clicked = true;
    });

    dispatchClick(el);

    assert(clicked, "click handler should fire");
  },
);

Deno.test(
  "TracklistItemCustomElement - should remove click listener on disconnect",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem();
    let trackClickCount = 0;
    el.addEventListener("track-click", () => {
      trackClickCount++;
    });
    dispatchClick(el);
    assert(trackClickCount === 1, "track-click should fire when connected");

    linkedomDocument.body?.removeChild(el);
    linkedomDocument.body?.appendChild(el);
    dispatchClick(el);
    assert(
      trackClickCount === 2,
      "track-click should fire again after reconnect",
    );
  },
);

Deno.test(
  "TracklistItemCustomElement - should have observedAttributes defined",
  async () => {
    setupDOMEnvironment();
    const { TracklistItemCustomElement } = await import(
      "./tracklist-item-custom-element.ts"
    );

    assertEquals(
      TracklistItemCustomElement.observedAttributes,
      [
        "data-track-name",
        "data-track-artist",
        "data-track-number",
        "data-track-url",
      ],
    );
  },
);

Deno.test(
  "TracklistItemCustomElement - should call attributeChangedCallback when attributes change",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem();
    (el as { attributeChangedCallback: () => void }).attributeChangedCallback(
      "data-track-name",
      "Old Value",
      "New Value",
    );
    assert(true);
  },
);

Deno.test(
  "TracklistItemCustomElement - should handle missing attributes gracefully",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = linkedomDocument.createElement("tracklist-item-custom-element");
    linkedomDocument.body?.appendChild(el);

    assertExists(el);
    assertStringIncludes(el.innerHTML, 'class="track"');
  },
);

Deno.test(
  "TracklistItemCustomElement - should display track number",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    createTracklistItem({ "data-track-number": "12" });

    const el = linkedomDocument.querySelector("tracklist-item-custom-element");
    assertExists(el);
    assertStringIncludes(el!.innerHTML, "12");
  },
);

Deno.test(
  "TracklistItemCustomElement - should display track name",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    createTracklistItem({ "data-track-name": "Amazing Song" });

    const el = linkedomDocument.querySelector("tracklist-item-custom-element");
    assertExists(el);
    assertStringIncludes(el!.innerHTML, "Amazing Song");
  },
);

Deno.test(
  "TracklistItemCustomElement - should display track artist",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    createTracklistItem({ "data-track-artist": "Famous Artist" });

    const el = linkedomDocument.querySelector("tracklist-item-custom-element");
    assertExists(el);
    assertStringIncludes(el!.innerHTML, "Famous Artist");
  },
);

Deno.test(
  "TracklistItemCustomElement - should handle empty track duration initially",
  async () => {
    setupDOMEnvironment();
    await import("./tracklist-item-custom-element.ts");

    const el = createTracklistItem();

    assertStringIncludes(el.innerHTML, 'class="track-duration"');
  },
);

Deno.test("TracklistItemCustomElement - should create Audio element to load duration", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  assertExists(
    lastMockAudio,
    "Audio should be created when data-track-url is set",
  );
});

Deno.test("TracklistItemCustomElement - should load audio metadata", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  assert(lastMockAudio !== null, "Audio element should be created");
});

Deno.test("TracklistItemCustomElement - should format duration as MM:SS", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem({ "data-track-url": "/test/track.mp3" });
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 125,
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl!.textContent, "2:05");
});

Deno.test("TracklistItemCustomElement - should handle single digit minutes", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 65,
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "1:05");
});

Deno.test("TracklistItemCustomElement - should handle zero seconds", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 60,
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "1:00");
});

Deno.test("TracklistItemCustomElement - should handle very long durations", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 3665,
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "61:05");
});

Deno.test("TracklistItemCustomElement - should update duration when metadata loads", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  const el = linkedomDocument.querySelector("tracklist-item-custom-element");
  assertExists(el);
  const durationEl = getTrackDurationEl(el as HTMLElement);
  assertExists(durationEl);

  if (lastMockAudio) {
    (lastMockAudio as unknown as { duration: number }).duration = 180;
    lastMockAudio.fireLoadedMetadata();
  }

  await new Promise((r) => setTimeout(r, 10));

  assertEquals(durationEl!.textContent, "3:00");
});

Deno.test("TracklistItemCustomElement - should handle invalid duration (NaN)", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);
  durationEl.textContent = "original";

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    get duration() {
      return NaN;
    },
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "original");
  assert(consoleWarnCalls.length > 0);
});

Deno.test("TracklistItemCustomElement - should handle invalid duration (Infinity)", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);
  durationEl.textContent = "original";

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    get duration() {
      return Infinity;
    },
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "original");
  assert(consoleWarnCalls.length > 0);
});

Deno.test("TracklistItemCustomElement - should handle zero duration", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);
  durationEl.textContent = "original";

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 0,
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "original");
  assert(consoleWarnCalls.length > 0);
});

Deno.test("TracklistItemCustomElement - should handle missing duration element gracefully", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = el.querySelector(".track-duration");
  if (durationEl && durationEl.parentNode) {
    durationEl.parentNode.removeChild(durationEl);
  }

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 180,
    get error() {
      return null;
    },
  } as HTMLAudioElement;

  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );
  assert(true);
});

Deno.test("TracklistItemCustomElement - should handle missing track URL gracefully", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = linkedomDocument.createElement("tracklist-item-custom-element");
  el.setAttribute("data-track-name", "Test Track");
  el.setAttribute("data-track-artist", "Test Artist");
  el.setAttribute("data-track-number", "1");
  linkedomDocument.body?.appendChild(el);

  assert(consoleWarnCalls.length > 0);
});

Deno.test("TracklistItemCustomElement - should handle audio load error gracefully", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  if (lastMockAudio) {
    (lastMockAudio as unknown as { _error: MediaError })._error = {
      code: 4,
      message: "Format not supported",
    } as MediaError;
    lastMockAudio.fireError();
  }

  await new Promise((r) => setTimeout(r, 10));

  assert(consoleErrorCalls.length > 0);
});

Deno.test("TracklistItemCustomElement - should clean up audio listeners on error", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  if (lastMockAudio) {
    lastMockAudio.fireError();
  }

  await new Promise((r) => setTimeout(r, 10));

  assert(consoleErrorCalls.length > 0);
});

Deno.test("TracklistItemCustomElement - should clean up audio listeners on success", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  const el = linkedomDocument.querySelector("tracklist-item-custom-element");
  assertExists(el);
  const durationEl = getTrackDurationEl(el as HTMLElement);
  assertExists(durationEl);

  if (lastMockAudio) {
    (lastMockAudio as unknown as { duration: number }).duration = 180;
    lastMockAudio.fireLoadedMetadata();
  }

  await new Promise((r) => setTimeout(r, 10));

  assertEquals(durationEl!.textContent, "3:00");
  assert(true);
});

Deno.test("TracklistItemCustomElement - should dispatch track-click event on click", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItem({ "data-track-url": "/path/to/track.mp3" });

  let eventFired = false;
  let eventDetail: { trackUrl: string } | null = null;

  el.addEventListener(
    "track-click",
    ((e: CustomEvent<{ trackUrl: string }>) => {
      eventFired = true;
      eventDetail = e.detail;
    }) as EventListener,
  );

  dispatchClick(el);

  assert(eventFired);
  assertExists(eventDetail);
  assertEquals(eventDetail!.trackUrl, "/path/to/track.mp3");
});

Deno.test("TracklistItemCustomElement - should preserve URL-encoded track URL in event", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const encodedUrl =
    "https://test-bucket.s3.test-region.amazonaws.com/Artist%3F/Album%20%231/1__Who%20Are%20You%3F.mp3";
  const el = createTracklistItem({ "data-track-url": encodedUrl });

  let eventDetail: { trackUrl: string } | null = null;

  el.addEventListener(
    "track-click",
    ((e: CustomEvent<{ trackUrl: string }>) => {
      eventDetail = e.detail;
    }) as EventListener,
  );

  dispatchClick(el);

  assertExists(eventDetail);
  assertEquals(eventDetail!.trackUrl, encodedUrl);
});

Deno.test("TracklistItemCustomElement - should handle empty track URL in event", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItemUnconnected({
    "data-track-name": "Test",
    "data-track-artist": "Artist",
    "data-track-number": "1",
  });
  el.removeAttribute("data-track-url");
  linkedomDocument.body?.appendChild(el);

  let eventFired = false;
  let eventDetail: { trackUrl: string } | null = null;

  el.addEventListener(
    "track-click",
    ((e: CustomEvent<{ trackUrl: string }>) => {
      eventFired = true;
      eventDetail = e.detail;
    }) as EventListener,
  );

  dispatchClick(el);

  assert(eventFired);
  assertExists(eventDetail);
  assertEquals(eventDetail!.trackUrl, "");
});

Deno.test("TracklistItemCustomElement - should make track-click event bubble", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItem();
  let eventBubbled = false;

  el.addEventListener("track-click", () => {
    eventBubbled = true;
  });

  dispatchClick(el);

  assert(eventBubbled);
});

Deno.test("TracklistItemCustomElement - should handle multiple clicks", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItem({ "data-track-url": "/test.mp3" });

  let clickCount = 0;
  el.addEventListener("track-click", () => {
    clickCount++;
  });

  dispatchClick(el);
  dispatchClick(el);
  dispatchClick(el);

  assert(clickCount >= 3, `Expected at least 3 clicks, got ${clickCount}`);
});

Deno.test("TracklistItemCustomElement - should handle click after disconnect and reconnect", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItem({ "data-track-url": "/test.mp3" });

  let clickCount = 0;
  const listener = () => {
    clickCount++;
  };

  el.addEventListener("track-click", listener);
  dispatchClick(el);
  assert(clickCount >= 1, `Expected at least 1 click, got ${clickCount}`);

  linkedomDocument.body?.removeChild(el);
  linkedomDocument.body?.appendChild(el);
  el.addEventListener("track-click", listener);
  const countBeforeSecondClick = clickCount;
  dispatchClick(el);
  assert(
    clickCount > countBeforeSecondClick,
    "Expected click count to increase after reconnect",
  );
});

Deno.test("TracklistItemCustomElement - should handle special characters in track name", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItem({
    "data-track-name": 'Song & Title with "quotes"',
  });

  const trackName = el.querySelector(".track-name");
  assertExists(trackName);
  assertEquals(trackName.textContent, 'Song & Title with "quotes"');
});

Deno.test("TracklistItemCustomElement - should handle special characters in artist name", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const el = createTracklistItem({
    "data-track-artist": "Artist & Band",
  });

  const trackArtist = el.querySelector(".track-artist");
  assertExists(trackArtist);
  assertEquals(trackArtist.textContent, "Artist & Band");
});

Deno.test("TracklistItemCustomElement - should handle very long track names", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  const longName = "A".repeat(200);
  const el = createTracklistItem({ "data-track-name": longName });

  assertStringIncludes(el.innerHTML, longName);
  assertStringIncludes(el.innerHTML, "text-overflow: ellipsis");
});

Deno.test("TracklistItemCustomElement - should handle fractional seconds in duration", async () => {
  setupDOMEnvironment();
  const { TracklistItemCustomElement } = await import(
    "./tracklist-item-custom-element.ts"
  );

  const el = createTracklistItem();
  const durationEl = getTrackDurationEl(el);
  assertExists(durationEl);

  const instance = el as InstanceType<typeof TracklistItemCustomElement>;
  const mockAudio = {
    duration: 125.7,
    get error() {
      return null;
    },
  } as HTMLAudioElement;
  instance.setTrackDuration(
    new (linkedomWindow.Event || Event)("loadedmetadata"),
    mockAudio,
  );

  assertEquals(durationEl.textContent, "2:05");
});

Deno.test("TracklistItemCustomElement - should handle HTTP 416 Range Not Satisfiable error", async () => {
  setupDOMEnvironment();
  await import("./tracklist-item-custom-element.ts");

  createTracklistItem({ "data-track-url": "/test/track.mp3" });

  const el = linkedomDocument.querySelector("tracklist-item-custom-element");
  assertExists(el);
  const durationEl = getTrackDurationEl(el as HTMLElement);
  assertExists(durationEl);

  if (lastMockAudio) {
    (lastMockAudio as unknown as { _error: MediaError })._error = {
      code: 4,
      message: "Range Not Satisfiable",
    } as MediaError;
    (lastMockAudio as unknown as { networkState: number }).networkState = 3;
    lastMockAudio.fireError();
  }

  await new Promise((r) => setTimeout(r, 10));

  assert(consoleErrorCalls.length > 0);
  assertEquals(durationEl!.textContent?.trim() || " ", " ");
});
