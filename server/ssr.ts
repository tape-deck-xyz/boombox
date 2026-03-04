/** @file Server-side rendering utilities.
 *  Renders full HTML page (document shell + layout) for custom elements / static HTML.
 *  Document shell (head, body, meta) is separate from layout (main, PlayBar).
 *  CSS and JS paths are fixed (see CSS_PATH and JS_PATH below); all pages use the same assets.
 */

import {
  FRAGMENT_REQUEST_HEADER,
  FRAGMENT_REQUEST_VALUE,
  type FragmentEnvelope,
  type FragmentMetaItem,
} from "../lib/fragment-envelope.ts";

const CSS_PATH = "/app.css";
const JS_PATH = "/build/main.js";

const DEFAULT_DESCRIPTION = "Your audio where you want it.";

export { FRAGMENT_REQUEST_HEADER, FRAGMENT_REQUEST_VALUE };
export type { FragmentEnvelope, FragmentMetaItem };

/**
 * True when the request asks for a fragment response (main content as JSON envelope).
 * Used by HTML handlers to return { title, html, meta } instead of full document.
 *
 * @param req - The incoming request.
 * @returns True if req has X-Requested-With: fetch.
 */
export function isFragmentRequest(req: Request): boolean {
  return req.headers.get(FRAGMENT_REQUEST_HEADER) === FRAGMENT_REQUEST_VALUE;
}

/**
 * Escape string for safe use in HTML attribute values and meta content
 * (e.g. title, og:content, data attributes).
 *
 * @param s - Raw string (e.g. user-controlled or dynamic text).
 * @returns Escaped string safe for double-quoted attribute values.
 */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Options for rendering the document head. */
export interface RenderHeadOptions {
  /** Page title (escaped). */
  title: string;
  /** Meta description (escaped). Defaults to default tagline. */
  description?: string;
  /** Optional link elements (e.g. preconnect, preload). */
  headLinks?: Array<{ rel: string; href: string }>;
  /**
   * Optional raw HTML for head (OG meta, style blocks, etc.).
   * Must be safe HTML; escape any dynamic or user-controlled values with {@link escapeAttr}.
   */
  headExtra?: string;
}

/**
 * Render the document head inner HTML (no wrapping `<head>` tag).
 * Used by the document shell to build the full page.
 *
 * @param options - Title, description, optional headLinks and headExtra.
 * @returns HTML string for head content.
 */
export function renderHead(options: RenderHeadOptions): string {
  const {
    title,
    description = DEFAULT_DESCRIPTION,
    headLinks = [],
    headExtra = "",
  } = options;
  const parts = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    `<link rel="stylesheet" href="${CSS_PATH}" />`,
    `<link rel="preload" href="${JS_PATH}" as="script" />`,
    ...headLinks.map(
      (link) =>
        `<link rel="${escapeAttr(link.rel)}" href="${
          escapeAttr(link.href)
        }" />`,
    ),
  ];
  if (headExtra) {
    parts.push(headExtra);
  }
  return parts.join("\n    ");
}

/**
 * Render the full HTML document (DOCTYPE, html, head, body).
 * No layout logic; only the document shell.
 *
 * @param headHtml - Inner HTML for `<head>`.
 * @param bodyHtml - Inner HTML for `<body>`.
 * @returns Full document string.
 */
export function renderDocument(headHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="bg-black text-white">
  <head>
    ${headHtml}
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`;
}

/** Options for rendering the page layout (main, PlayBar). */
export interface RenderLayoutOptions {
  isAdmin: boolean;
  /** HTML for the main content area. */
  mainContentHtml: string;
  /** Optional album URL for PlayBar data-album-url (e.g. on album page). */
  playbarAlbumUrl?: string;
}

const TRACK_CLICK_SCRIPT = `
    document.addEventListener("track-click", (event) => {
      const customEvent = event instanceof CustomEvent ? event : null;
      if (customEvent && customEvent.detail) {
        const trackUrl = customEvent.detail.trackUrl;
        const playbar = document.querySelector('playbar-custom-element');
        if (playbar) {
          playbar.setAttribute('data-current-track-url', trackUrl);
          playbar.setAttribute('data-is-playing', 'true');
        }
      }
    });
  `;

const BLANK_SLATE_SCRIPT = `
    document.addEventListener("click", (e) => {
      const btn = e.target && "closest" in e.target ? e.target.closest("#blank-slate-upload") : null;
      if (btn) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("upload-dialog-open"));
      }
    });
  `;

/**
 * Render the body content: main slot, PlayBar, optional admin upload button, and scripts.
 * Layout only; no head or document wrapper.
 *
 * @param options - Main content HTML, optional PlayBar album URL, isAdmin for upload button.
 * @returns HTML string for body content.
 */
export function renderLayout(options: RenderLayoutOptions): string {
  const {
    isAdmin,
    mainContentHtml,
    playbarAlbumUrl,
  } = options;

  const playbarAttrs = playbarAlbumUrl != null && playbarAlbumUrl !== ""
    ? ` data-album-url="${escapeAttr(playbarAlbumUrl)}"`
    : "";

  const adminUploadHtml = isAdmin
    ? '<div class="upload-fab"><upload-dialog-custom-element buttonStyle="width: 24px; height: 24px;" /></div>'
    : "";

  return `<div id="root">
      <div class="layout-root-inner">
        ${adminUploadHtml}
        <main class="layout-main">
          ${mainContentHtml}
        </main>
        <site-footer-custom-element
          label='<a href="https://tape-deck.xyz/boombox">BoomBox</a>'
          tagline='Built by <a href="https://tape-deck.xyz">tape-deck.xyz</a>. Open source under MIT.'
        ></site-footer-custom-element>
      </div>
    </div>
    <playbar-custom-element${playbarAttrs}></playbar-custom-element>
    <script type="module" src="${JS_PATH}"></script>
    <script>${TRACK_CLICK_SCRIPT}</script>
    <script>${BLANK_SLATE_SCRIPT}</script>`;
}

/** Props for renderPage (public API for handlers). */
export interface RenderPageProps {
  appName: string;
  headLinks?: Array<{ rel: string; href: string }>;
  pathname?: string;
  isAdmin?: boolean;
  /** Override page title (defaults to appName). */
  title?: string;
  /** Override meta description. */
  description?: string;
  /**
   * Extra head HTML (OG meta, style block, etc.).
   * Must be safe HTML; escape any dynamic or user-controlled values with {@link escapeAttr}.
   */
  headExtra?: string;
  /** Optional PlayBar data-album-url (e.g. on album page). */
  playbarAlbumUrl?: string;
}

/**
 * Render the full HTML page (shell + layout). Used by index and album handlers.
 * Every page gets main content, PlayBar, and the track-click script.
 *
 * @param props - Page options. Optional title, description, headExtra, playbarAlbumUrl.
 * @param children - HTML fragments for the main content (e.g. album rows, tracklist).
 * @returns Full HTML document string.
 */
export function renderPage(
  props: RenderPageProps,
  children: Array<string>,
): string {
  const isAdmin = props.isAdmin ?? false;
  const title = props.title ?? props.appName;
  const description = props.description ?? DEFAULT_DESCRIPTION;

  const headHtml = renderHead({
    title,
    description,
    headLinks: props.headLinks ?? [],
    headExtra: props.headExtra ?? "",
  });

  const bodyHtml = renderLayout({
    isAdmin,
    mainContentHtml: children.join(""),
    playbarAlbumUrl: props.playbarAlbumUrl,
  });

  return renderDocument(headHtml, bodyHtml);
}
