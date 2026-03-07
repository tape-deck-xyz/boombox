/** @file Custom element for refreshing the library cache.
 *
 * Renders a button that fetches `/info?refresh=1` with credentials to force
 * a cache refresh. On success, reloads the page to show fresh data. Visible
 * only to admins (included in layout when isAdmin is true).
 */

import "../../icons/arrow-path/index.ts";

/**
 * Custom element for refreshing the library cache.
 *
 * Fetches `/info?refresh=1` with credentials to regenerate the info cache,
 * then reloads the page. Requires admin Basic Auth for the refresh endpoint.
 *
 * @customElement refresh-cache-custom-element
 *
 * @example
 * ```html
 * <refresh-cache-custom-element></refresh-cache-custom-element>
 * ```
 *
 * ## Attributes
 *
 * None. The element has no observed attributes.
 *
 * ## Events
 *
 * None. The element does not dispatch custom events.
 *
 * ## Slots
 *
 * None.
 *
 * ## Properties
 *
 * None. The element does not expose a public JS API.
 */

// TEMPLATE ///////////////////////////////////////////////////////////////////

const template = document.createElement("template");

template.innerHTML = `
  <style>
    :host {
      display: inline-flex;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0;
      color: inherit;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    button:focus {
      outline: none;
    }
    button:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    arrow-path-icon {
      width: 1.5rem;
      height: 1.5rem;
      display: block;
    }
    button.loading arrow-path-icon {
      animation: refresh-spin 0.6s linear infinite;
    }
    @keyframes refresh-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .error-message {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 0.25rem;
      padding: 0.5rem 0.75rem;
      background: rgba(220, 38, 38, 0.9);
      color: white;
      font-size: 0.875rem;
      border-radius: 0.375rem;
      white-space: nowrap;
      z-index: 100;
    }
  </style>
  <div style="position: relative;">
    <button type="button" id="trigger" aria-label="Refresh library" title="Refresh library">
      <arrow-path-icon class="size-6"></arrow-path-icon>
    </button>
  </div>
`;

export class RefreshCacheCustomElement extends HTMLElement {
  #trigger: HTMLButtonElement | null = null;
  #abortController: AbortController | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
    this.#trigger = this.shadowRoot!.getElementById("trigger") as
      | HTMLButtonElement
      | null;
  }

  connectedCallback(): void {
    this.#trigger?.addEventListener("click", this.#onClick);
  }

  disconnectedCallback(): void {
    this.#trigger?.removeEventListener("click", this.#onClick);
    this.#abortController?.abort();
  }

  #onClick = async (): Promise<void> => {
    if (!this.#trigger || this.#trigger.disabled) return;

    this.#trigger.disabled = true;
    this.#trigger.classList.add("loading");
    this.#clearError();

    this.#abortController = new AbortController();

    try {
      const url = new URL("/info?refresh=1", globalThis.location.origin);
      const response = await fetch(url.toString(), {
        credentials: "include",
        signal: this.#abortController.signal,
      });

      if (response.ok) {
        location.reload();
        return;
      }

      const text = await response.text();
      this.#showError(
        response.status === 401
          ? "Please log in to refresh the library."
          : `Refresh failed: ${response.status} ${text || response.statusText}`,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      this.#showError(
        err instanceof Error ? err.message : "Refresh failed",
      );
    } finally {
      this.#trigger.disabled = false;
      this.#trigger.classList.remove("loading");
    }
  };

  #showError(message: string): void {
    this.#clearError();
    const wrapper = this.shadowRoot!.querySelector("div");
    if (!wrapper) return;
    const el = document.createElement("div");
    el.className = "error-message";
    el.textContent = message;
    el.setAttribute("role", "alert");
    wrapper.appendChild(el);
    setTimeout(() => this.#clearError(), 5000);
  }

  #clearError(): void {
    const el = this.shadowRoot!.querySelector(".error-message");
    el?.remove();
  }
}

customElements.define(
  "refresh-cache-custom-element",
  RefreshCacheCustomElement,
);
