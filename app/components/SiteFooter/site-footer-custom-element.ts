/** @file Custom element for the site footer.
 *
 * Renders a subtle, muted footer with a label on the left and a tagline on
 * the right. Designed to fade into the background — low-opacity text on the
 * dark app background. The PlayBar (position: fixed; z-index: 10) naturally
 * covers this element when it slides up.
 *
 * @customElement site-footer-custom-element
 */

function buildTemplate(): HTMLTemplateElement {
  const tmpl = document.createElement("template");

  const style = document.createElement("style");
  style.textContent = `
    :host {
      display: block;
      width: 100%;
    }
    footer {
      padding: 0.625rem 1.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    span {
      font-size: 0.6875rem;
      color: rgba(255, 255, 255, 0.2);
      letter-spacing: 0.03em;
      line-height: 1.4;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  `;

  const footer = document.createElement("footer");

  const labelSpan = document.createElement("span");
  labelSpan.id = "label";

  const taglineSpan = document.createElement("span");
  taglineSpan.id = "tagline";

  footer.appendChild(labelSpan);
  footer.appendChild(taglineSpan);

  tmpl.content.appendChild(style);
  tmpl.content.appendChild(footer);

  return tmpl;
}

const template = buildTemplate();

/**
 * Site footer custom element. Displays a label and tagline in a subtle,
 * muted style that blends into the dark app background.
 *
 * The `label` and `tagline` attributes accept plain text or a string
 * containing anchor tags for inline links. Values come from the server
 * template (not user input), so setting innerHTML is safe here.
 * All links rendered inside the footer are automatically given
 * `target="_blank"` and `rel="noopener noreferrer"`.
 *
 * @customElement site-footer-custom-element
 *
 * @example
 * ```html
 * <site-footer-custom-element
 *   label="BoomBox"
 *   tagline="Open source under MIT.">
 * </site-footer-custom-element>
 * ```
 *
 * ## Attributes
 *
 * ### `label` (string)
 * Left-side text. Accepts plain text or a string containing anchor tags.
 * Rendered as the left column of the footer row.
 *
 * ### `tagline` (string)
 * Right-side text. Accepts plain text or a string containing anchor tags.
 * Rendered as the right column of the footer row.
 */
export class SiteFooterCustomElement extends HTMLElement {
  static observedAttributes = ["label", "tagline"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(
    _name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    this.#render();
  }

  #render(): void {
    const labelEl = this.shadowRoot!.querySelector("#label");
    const taglineEl = this.shadowRoot!.querySelector("#tagline");
    // Values originate from the server template, not user input — innerHTML is safe.
    if (labelEl) labelEl.innerHTML = this.getAttribute("label") ?? "";
    if (taglineEl) taglineEl.innerHTML = this.getAttribute("tagline") ?? "";
    for (const a of this.shadowRoot!.querySelectorAll("a")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
}

customElements.define("site-footer-custom-element", SiteFooterCustomElement);
