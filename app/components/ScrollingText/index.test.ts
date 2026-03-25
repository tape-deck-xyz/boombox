/** @file Tests for ScrollingTextCustomElement
 *
 * Covers the scrolling text (marquee) element: scrolls when content overflows,
 * static when it fits. Tests lifecycle, shadow DOM, overflow detection,
 * ResizeObserver/MutationObserver, and cleanup.
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno. Polyfills requestAnimationFrame and mocks
 * ResizeObserver/getComputedStyle for determinism.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { createLinkedomEnv, wireLinkedomToGlobal } from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

// ============================================================================
// MOCK STATE
// ============================================================================

const resizeObserverObservedElements: Set<unknown> = new Set();
const resizeObserverCallbacks: (() => void)[] = [];
const mutationObserverObservedElements: Set<unknown> = new Set();
const mutationObserverCallbacks: (() => void)[] = [];
const cancelAnimationFrameCalls: number[] = [];
let animationFrameIdCounter = 0;
const animationFrameCallbacks: Map<number, () => void> = new Map();

// ============================================================================
// DOM SETUP (must run before importing the element module)
// ============================================================================

function setupDOMEnvironment() {
  resizeObserverObservedElements.clear();
  resizeObserverCallbacks.length = 0;
  mutationObserverObservedElements.clear();
  mutationObserverCallbacks.length = 0;
  cancelAnimationFrameCalls.length = 0;
  animationFrameIdCounter = 0;
  animationFrameCallbacks.clear();

  wireLinkedomToGlobal(linkedomWindow, linkedomDocument);

  // Override RAF: run via queueMicrotask so Deno's test sanitizer never sees
  // orphan setTimeouts (linkedomWindow.setTimeout was leaking when tests ended
  // before the 0ms timers fired).
  (globalThis as { requestAnimationFrame: typeof requestAnimationFrame })
    .requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = ++animationFrameIdCounter;
      animationFrameCallbacks.set(id, () => callback(0));
      queueMicrotask(() => {
        const fn = animationFrameCallbacks.get(id);
        if (fn) {
          fn();
          animationFrameCallbacks.delete(id);
        }
      });
      return id;
    };
  (globalThis as { cancelAnimationFrame: typeof cancelAnimationFrame })
    .cancelAnimationFrame = (id: number) => {
      cancelAnimationFrameCalls.push(id);
      animationFrameCallbacks.delete(id);
    };

  // Mock ResizeObserver (linkedom does not provide it)
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    class ResizeObserver {
      callback: () => void;

      constructor(callback: () => void) {
        this.callback = callback;
        resizeObserverCallbacks.push(callback);
      }

      observe(target: Element) {
        resizeObserverObservedElements.add(target);
      }

      disconnect() {
        const idx = resizeObserverCallbacks.indexOf(this.callback);
        if (idx !== -1) resizeObserverCallbacks.splice(idx, 1);
      }
    };

  // Mock MutationObserver (linkedom compatibility; we track and manually trigger)
  (globalThis as { MutationObserver: typeof MutationObserver })
    .MutationObserver = class MutationObserver {
      callback: MutationCallback;

      constructor(callback: MutationCallback) {
        this.callback = callback;
        mutationObserverCallbacks.push(callback as () => void);
      }

      observe(target: Node, _options?: MutationObserverInit) {
        mutationObserverObservedElements.add(target);
      }

      disconnect() {
        const idx = mutationObserverCallbacks.indexOf(
          this.callback as () => void,
        );
        if (idx !== -1) mutationObserverCallbacks.splice(idx, 1);
      }
    };

  // Mock getComputedStyle for temp span width measurement (linkedom layout is limited)
  (globalThis as { getComputedStyle: typeof getComputedStyle })
    .getComputedStyle = (_el: Element) =>
      ({
        font: "16px sans-serif",
        fontSize: "16px",
        fontFamily: "sans-serif",
        fontWeight: "400",
        letterSpacing: "normal",
        getPropertyValue: () => "",
      }) as CSSStyleDeclaration;
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/** Creates a scrolling-text element in the DOM. Uses document.createElement and
 * appendChild so connectedCallback fires naturally. Optionally patches
 * offsetWidth for overflow tests. */
function createScrollingText(options?: {
  textContent?: string;
  offsetWidth?: number;
}): HTMLElement {
  const body = linkedomDocument.body;
  if (!body) throw new Error("body not found");
  const el = linkedomDocument.createElement("scrolling-text-custom-element");
  if (options?.textContent !== undefined) {
    el.textContent = options.textContent;
  }
  if (options?.offsetWidth !== undefined) {
    Object.defineProperty(el, "offsetWidth", {
      value: options.offsetWidth,
      configurable: true,
    });
  }
  body.appendChild(el);
  return el as HTMLElement;
}

function getContainer(el: HTMLElement): HTMLElement | null {
  return el.shadowRoot?.querySelector(".scrolling-text-container") ?? null;
}

function getTextContent(el: HTMLElement): HTMLElement | null {
  return el.shadowRoot?.querySelector(".scrolling-text-content") ?? null;
}

function getDuplicate(el: HTMLElement): HTMLElement | null {
  return el.shadowRoot?.querySelector(".scrolling-text-duplicate") ?? null;
}

/** Drains rAF callbacks (polyfill uses setTimeout). */
async function waitForLayout(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => linkedomWindow.setTimeout(r, 0));
  }
}

function triggerMutationObserver(): void {
  mutationObserverCallbacks.forEach((cb) => cb());
}

// ============================================================================
// TESTS
// ============================================================================

Deno.test(
  "ScrollingTextCustomElement - element can be created",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    assertExists(el);
    assertEquals(el.constructor.name, "ScrollingTextCustomElement");
  },
);

Deno.test(
  "ScrollingTextCustomElement - creates shadow DOM with template",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    assertExists(el.shadowRoot);
    const html = el.shadowRoot?.innerHTML ?? "";
    assert(html.includes("scrolling-text-container"));
    assert(html.includes("scrolling-text-content"));
    assert(html.includes("scrolling-text-duplicate"));
    assert(html.includes("@keyframes scroll-text"));
  },
);

Deno.test(
  "ScrollingTextCustomElement - registers custom element",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    assertEquals(
      linkedomDocument.createElement("scrolling-text-custom-element")
        .constructor.name,
      "ScrollingTextCustomElement",
    );
    assertExists(el);
  },
);

Deno.test(
  "ScrollingTextCustomElement - requestAnimationFrame callbacks run in waitForLayout",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    let ran = false;
    requestAnimationFrame(() => {
      ran = true;
    });
    await waitForLayout();

    assert(ran, "rAF callback should run when waitForLayout drains queue");
  },
);

Deno.test(
  "ScrollingTextCustomElement - does not scroll when text fits within container",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    // Patch host offsetWidth to 500 so container is wide; short text will fit
    const el = createScrollingText({
      textContent: "Short",
      offsetWidth: 500,
    });

    await waitForLayout();

    const container = getContainer(el);
    assertExists(container);
    assert(
      !container.classList.contains("scrolling"),
      "should not have scrolling class when text fits",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - does not scroll when container width is zero",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText({
      textContent: "Long text that would overflow",
      offsetWidth: 0,
    });

    await waitForLayout();

    const container = getContainer(el);
    assertExists(container);
    assert(
      !container.classList.contains("scrolling"),
      "should not scroll when container width is zero",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - moves text content from light DOM to shadow DOM",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText({ textContent: "Test text" });

    await waitForLayout();

    const text = getTextContent(el);
    const duplicate = getDuplicate(el);
    assertExists(text);
    assertExists(duplicate);
    assertEquals(text.textContent, "Test text");
    assertEquals(duplicate.textContent, "Test text");
  },
);

Deno.test(
  "ScrollingTextCustomElement - handles empty content gracefully",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    await waitForLayout();

    assertExists(el);
    const text = getTextContent(el);
    assertExists(text);
    assertEquals(text.textContent, "");
  },
);

Deno.test(
  "ScrollingTextCustomElement - updates content when child nodes change",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText({ textContent: "Initial text" });

    await waitForLayout();

    el.textContent = "Updated text";
    triggerMutationObserver();
    await waitForLayout();

    const text = getTextContent(el);
    assertExists(text);
    assertEquals(text.textContent, "Updated text");
  },
);

Deno.test(
  "ScrollingTextCustomElement - observes element for size changes",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    assert(
      resizeObserverObservedElements.has(el),
      "ResizeObserver should observe host element",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - disconnects ResizeObserver on disconnect",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();
    const initialCount = resizeObserverCallbacks.length;

    linkedomDocument.body?.removeChild(el);

    assert(
      resizeObserverCallbacks.length < initialCount,
      "ResizeObserver should be disconnected",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - observes element for mutation changes",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    assert(
      mutationObserverObservedElements.has(el),
      "MutationObserver should observe host element",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - disconnects MutationObserver on disconnect",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();
    const initialCount = mutationObserverCallbacks.length;

    linkedomDocument.body?.removeChild(el);

    assert(
      mutationObserverCallbacks.length < initialCount,
      "MutationObserver should be disconnected",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - cancels animation frames on disconnect",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    await waitForLayout();

    linkedomDocument.body?.removeChild(el);

    assert(
      cancelAnimationFrameCalls.length > 0,
      "cancelAnimationFrame should be called on disconnect",
    );
  },
);

Deno.test(
  "ScrollingTextCustomElement - handles multiple connect/disconnect cycles",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();
    const body = linkedomDocument.body;
    if (!body) throw new Error("body not found");

    body.removeChild(el);
    body.appendChild(el);
    body.removeChild(el);
    body.appendChild(el);

    assertExists(el);
  },
);

Deno.test(
  "ScrollingTextCustomElement - handles rapid content changes",
  async () => {
    setupDOMEnvironment();
    await import("./index.ts");

    const el = createScrollingText();

    el.textContent = "Text 1";
    triggerMutationObserver();
    await waitForLayout();

    el.textContent = "Text 2";
    triggerMutationObserver();
    await waitForLayout();

    el.textContent = "Text 3";
    triggerMutationObserver();
    await waitForLayout();

    const text = getTextContent(el);
    assertExists(text);
    assertEquals(text.textContent, "Text 3");
  },
);
