/** @file Tests for SiteFooterCustomElement
 *
 * Covers shadow DOM structure, attribute rendering (label and tagline),
 * attributeChangedCallback updates, and element registration.
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  createCustomElement,
  createLinkedomEnv,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

function setup() {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument);
}

function getLabelEl(el: HTMLElement): Element | null {
  return el.shadowRoot?.querySelector("#label") ?? null;
}

function getTaglineEl(el: HTMLElement): Element | null {
  return el.shadowRoot?.querySelector("#tagline") ?? null;
}

Deno.test("SiteFooterCustomElement - registers as site-footer-custom-element", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = linkedomDocument.createElement("site-footer-custom-element");
  assertEquals(el.constructor.name, "SiteFooterCustomElement");
});

Deno.test("SiteFooterCustomElement - creates shadow DOM with footer element", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
  );

  assertExists(el.shadowRoot);
  assertExists(el.shadowRoot.querySelector("footer"));
});

Deno.test("SiteFooterCustomElement - renders label attribute into #label span", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      label: "BoomBox",
    },
  );

  const labelEl = getLabelEl(el);
  assertExists(labelEl);
  assertEquals(labelEl.textContent, "BoomBox");
});

Deno.test("SiteFooterCustomElement - renders tagline attribute into #tagline span", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      tagline: "Built by tape-deck.xyz. Open source under MIT.",
    },
  );

  const taglineEl = getTaglineEl(el);
  assertExists(taglineEl);
  assertEquals(
    taglineEl.textContent,
    "Built by tape-deck.xyz. Open source under MIT.",
  );
});

Deno.test("SiteFooterCustomElement - renders both label and tagline together", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      label: "BoomBox",
      tagline: "Built by tape-deck.xyz. Open source under MIT.",
    },
  );

  assertEquals(getLabelEl(el)?.textContent, "BoomBox");
  assertEquals(
    getTaglineEl(el)?.textContent,
    "Built by tape-deck.xyz. Open source under MIT.",
  );
});

Deno.test("SiteFooterCustomElement - renders empty strings when attributes are absent", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
  );

  assertEquals(getLabelEl(el)?.textContent, "");
  assertEquals(getTaglineEl(el)?.textContent, "");
});

Deno.test("SiteFooterCustomElement - updates label when attribute changes", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      label: "Initial",
    },
  );

  assertEquals(getLabelEl(el)?.textContent, "Initial");

  el.setAttribute("label", "Updated");
  assertEquals(getLabelEl(el)?.textContent, "Updated");
});

Deno.test("SiteFooterCustomElement - updates tagline when attribute changes", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      tagline: "Original tagline.",
    },
  );

  assertEquals(getTaglineEl(el)?.textContent, "Original tagline.");

  el.setAttribute("tagline", "New tagline.");
  assertEquals(getTaglineEl(el)?.textContent, "New tagline.");
});

Deno.test("SiteFooterCustomElement - renders inline anchor in label attribute", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      label: `<a href="https://tape-deck.xyz/boombox">BoomBox</a>`,
    },
  );

  const labelEl = getLabelEl(el);
  assertExists(labelEl);
  const anchor = labelEl.querySelector("a");
  assertExists(anchor);
  assertEquals(anchor.getAttribute("href"), "https://tape-deck.xyz/boombox");
  assertEquals(anchor.textContent, "BoomBox");
});

Deno.test("SiteFooterCustomElement - renders partial inline anchor in tagline attribute", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      tagline:
        `Built by <a href="https://tape-deck.xyz">tape-deck.xyz</a>. Open source under MIT.`,
    },
  );

  const taglineEl = getTaglineEl(el);
  assertExists(taglineEl);
  const anchor = taglineEl.querySelector("a");
  assertExists(anchor);
  assertEquals(anchor.getAttribute("href"), "https://tape-deck.xyz");
  assertEquals(anchor.textContent, "tape-deck.xyz");
  assertEquals(
    taglineEl.textContent,
    "Built by tape-deck.xyz. Open source under MIT.",
  );
});

Deno.test("SiteFooterCustomElement - all anchors open in a new tab", async () => {
  setup();
  await import("./site-footer-custom-element.ts");

  const el = createCustomElement(
    linkedomDocument,
    "site-footer-custom-element",
    {
      label: `<a href="https://tape-deck.xyz/boombox">BoomBox</a>`,
      tagline:
        `Built by <a href="https://tape-deck.xyz">tape-deck.xyz</a>. Open source under MIT.`,
    },
  );

  const anchors = el.shadowRoot!.querySelectorAll("a");
  assertEquals(anchors.length, 2);
  for (const a of anchors) {
    assertEquals(a.getAttribute("target"), "_blank");
    assertEquals(a.getAttribute("rel"), "noopener noreferrer");
  }
});
