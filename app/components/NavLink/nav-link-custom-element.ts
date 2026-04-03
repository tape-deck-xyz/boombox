/** @file Custom element for same-origin app navigation with fragment loading.
 *
 * Renders as a link (slot content). On click, fetches the route with a fragment
 * request header, then updates main content, document title, and head meta
 * from the JSON envelope instead of full page load. Falls back to full
 * navigation on error or for non-app routes.
 *
 * @customElement nav-link
 */

import {
  FRAGMENT_REQUEST_HEADER,
  FRAGMENT_REQUEST_VALUE,
  type FragmentEnvelope,
} from "../../../lib/fragment-envelope.ts";
import { setLibraryContentsFromServer } from "../../util/info-client.ts";

/** Same-origin path (starts with "/"); any such route may be fetched as fragment. */
function isAppRoute(pathname: string): boolean {
  return pathname.startsWith("/");
}

const FRAGMENT_CRITICAL_STYLES_ID = "fragment-critical-styles";

/** Max consecutive fragment load failures before showing error instead of reload. */
const FRAGMENT_LOAD_MAX_ATTEMPTS = 4;

/** sessionStorage key for counting consecutive popstate fragment load failures. */
const FRAGMENT_FAILURES_KEY = "nav-link-fragment-failures";

/**
 * True when the response declares a JSON body (e.g. application/json or
 * application/json; charset=utf-8). Used to reject fragment responses that
 * are not from the expected API (e.g. HTML error pages) before parsing.
 */
function isJsonFragmentResponse(res: Response): boolean {
  const ct = res.headers.get("Content-Type")?.toLowerCase();
  return ct?.includes("application/json") ?? false;
}

/** Renders a simple error message in main when fragment load fails after max attempts. */
function showFragmentLoadError(): void {
  const main = document.querySelector("main");
  if (!main) return;
  main.innerHTML = `
    <div class="p-4 rounded-lg bg-base-200 text-base-content" role="alert">
      <p class="font-medium">Couldn't load this page</p>
      <p class="text-sm mt-1 opacity-90">The server may be unavailable. You can try again or reload the page.</p>
      <a href="${globalThis.location.href}" class="link link-primary mt-2 inline-block">Reload page</a>
    </div>`;
}

/** Remove all fragment-managed OG meta tags from document head. */
function clearFragmentManagedMeta(): void {
  const head = document.head;
  const ogMeta = head.querySelectorAll('meta[property^="og:"]');
  for (const el of ogMeta) {
    head.removeChild(el);
  }
}

function applyEnvelope(envelope: FragmentEnvelope): void {
  const main = document.querySelector("main");
  if (main) {
    main.innerHTML = envelope.html;
  }
  if (envelope.libraryContents !== undefined) {
    setLibraryContentsFromServer(envelope.libraryContents);
  }
  document.title = envelope.title;

  if (envelope.meta == null || envelope.meta.length === 0) {
    clearFragmentManagedMeta();
  } else {
    clearFragmentManagedMeta();
    for (const item of envelope.meta) {
      const selector = item.property
        ? `meta[property="${item.property}"]`
        : `meta[name="${item.name}"]`;
      let meta = document.querySelector(selector);
      if (!meta) {
        meta = document.createElement("meta");
        if (item.property) {
          meta.setAttribute("property", item.property);
        } else if (item.name) {
          meta.setAttribute("name", item.name);
        }
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", item.content);
    }
  }

  const stylesEl = document.getElementById(FRAGMENT_CRITICAL_STYLES_ID) as
    | HTMLStyleElement
    | null;
  if (envelope.styles) {
    // Server sends a single <style>...</style> block or raw CSS; we strip one surrounding tag and inject the inner CSS. Multiple style blocks are undefined.
    const css = envelope.styles.replace(/^<style[^>]*>|<\/style>$/gi, "")
      .trim();
    if (stylesEl) {
      stylesEl.textContent = css;
    } else {
      const el = document.createElement("style");
      el.id = FRAGMENT_CRITICAL_STYLES_ID;
      el.textContent = css;
      document.head.appendChild(el);
    }
  } else if (stylesEl) {
    stylesEl.remove();
  }
}

function navigateToFragment(url: URL): void {
  const main = document.querySelector("main");
  if (!main) {
    globalThis.location.href = url.href;
    return;
  }
  fetch(url.href, {
    headers: { [FRAGMENT_REQUEST_HEADER]: FRAGMENT_REQUEST_VALUE },
  })
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Fragment request failed: ${res.status}`);
      }
      if (!isJsonFragmentResponse(res)) {
        throw new Error("Fragment response must be application/json");
      }
      return res.json() as Promise<FragmentEnvelope>;
    })
    .then((envelope) => {
      applyEnvelope(envelope);
      globalThis.history.pushState(
        { pathname: url.pathname },
        envelope.title,
        url.href,
      );
    })
    .catch(() => {
      globalThis.location.href = url.href;
    });
}

let popstateRegistered = false;

/** Pending reload timers (scheduled delays); cleared when we show error after max attempts. */
const pendingReloadTimers: number[] = [];

function clearFragmentFailureCount(): void {
  try {
    globalThis.sessionStorage.removeItem(FRAGMENT_FAILURES_KEY);
  } catch {
    // Ignore when sessionStorage is unavailable (e.g. private mode)
  }
}

function clearPendingReloadTimers(): void {
  for (const id of pendingReloadTimers) {
    globalThis.clearTimeout(id);
  }
  pendingReloadTimers.length = 0;
}

function registerPopstate(): void {
  if (popstateRegistered) return;
  popstateRegistered = true;
  globalThis.addEventListener("popstate", () => {
    const url = new URL(globalThis.location.href);
    if (
      url.origin !== globalThis.location.origin || !isAppRoute(url.pathname)
    ) {
      return;
    }
    const main = document.querySelector("main");
    if (!main) return;
    fetch(url.href, {
      headers: { [FRAGMENT_REQUEST_HEADER]: FRAGMENT_REQUEST_VALUE },
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        if (!isJsonFragmentResponse(res)) {
          throw new Error("Fragment response must be application/json");
        }
        return res.json() as Promise<FragmentEnvelope>;
      })
      .then((envelope) => {
        clearFragmentFailureCount();
        applyEnvelope(envelope);
      })
      .catch(() => {
        let count = 0;
        try {
          const raw = globalThis.sessionStorage.getItem(FRAGMENT_FAILURES_KEY);
          count = Math.min(
            FRAGMENT_LOAD_MAX_ATTEMPTS,
            1 + parseInt(raw ?? "0", 10),
          );
          globalThis.sessionStorage.setItem(
            FRAGMENT_FAILURES_KEY,
            String(count),
          );
        } catch {
          count = 1;
        }
        if (count >= FRAGMENT_LOAD_MAX_ATTEMPTS) {
          clearPendingReloadTimers();
          clearFragmentFailureCount();
          showFragmentLoadError();
          return;
        }
        const delayMs = 500 * Math.pow(2, count - 1);
        const id = globalThis.setTimeout(() => {
          const idx = pendingReloadTimers.indexOf(id);
          if (idx !== -1) pendingReloadTimers.splice(idx, 1);
          globalThis.location.reload();
        }, delayMs);
        pendingReloadTimers.push(id);
      });
  });
}

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: inline;
    }
    #link {
      color: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    #link:hover {
      text-decoration: underline;
    }
  </style>
  <a id="link" href=""><slot></slot></a>
`;

/**
 * Custom element for client-side app navigation.
 *
 * Renders as an anchor element (via slot content). On click, sends a fragment
 * request to the server and updates `main`, `document.title`, and head meta
 * tags from the JSON envelope — no full page reload. Falls back to a full
 * navigation on error or for non-same-origin URLs. Also handles browser
 * back/forward via `popstate`.
 *
 * @customElement nav-link
 *
 * @example
 * ```html
 * <nav-link href="/">Home</nav-link>
 * <nav-link href="/artists/Artist/albums/Album">Album Name</nav-link>
 * ```
 *
 * ## Attributes
 *
 * ### `href` (string)
 * The destination URL. Same-origin paths (starting with `/`) are loaded as
 * fragments; external URLs fall back to a full navigation.
 *
 * ## Slots
 *
 * ### (default)
 * The link label content. Any HTML is accepted.
 */
export class NavLinkCustomElement extends HTMLElement {
  static observedAttributes = ["href"];

  private boundHandleClick = this.handleClick.bind(this);
  private boundHandleKeydown = this.handleKeydown.bind(this);

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
  }

  connectedCallback(): void {
    this.updateLinkAttrs();
    this.addEventListener("click", this.boundHandleClick);
    this.addEventListener("keydown", this.boundHandleKeydown);
    registerPopstate();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.boundHandleClick);
    this.removeEventListener("keydown", this.boundHandleKeydown);
  }

  attributeChangedCallback(
    _name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    this.updateLinkAttrs();
  }

  private updateLinkAttrs(): void {
    const href = this.getAttribute("href");
    const linkEl = this.shadowRoot?.querySelector?.("a") ?? null;
    if (linkEl) {
      linkEl.setAttribute("href", href ?? "");
    }
    if (href) {
      this.removeAttribute("role");
      this.removeAttribute("tabindex");
    } else {
      this.removeAttribute("role");
      this.setAttribute("tabindex", "-1");
    }
  }

  /** Returns true if fragment navigation was performed (caller should preventDefault). */
  private tryNavigate(): boolean {
    const href = this.getAttribute("href");
    if (!href) return false;
    const url = new URL(href, document.baseURI || undefined);
    if (url.origin !== globalThis.location.origin) return false;
    if (!isAppRoute(url.pathname)) return false;
    navigateToFragment(url);
    return true;
  }

  private handleClick(e: MouseEvent): void {
    // Let the browser handle modifier keys and non-primary button (e.g. open in new tab, new window)
    if (
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      (e.button != null && e.button !== 0)
    ) {
      return;
    }
    if (this.tryNavigate()) {
      e.preventDefault();
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      if (this.tryNavigate()) {
        e.preventDefault();
      }
    }
  }
}

customElements.define("nav-link", NavLinkCustomElement);

/** Resets popstate registration state for tests. Not for production use. */
export function _testResetPopstateState(): void {
  popstateRegistered = false;
  pendingReloadTimers.length = 0;
}
