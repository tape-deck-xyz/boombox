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
 * @example
 * ```html
 * <site-footer-custom-element
 *   label="BoomBox"
 *   tagline="Built by tape-deck.xyz. Open source under MIT."
 * ></site-footer-custom-element>
 * ```
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
    if (labelEl) labelEl.textContent = this.getAttribute("label") ?? "";
    if (taglineEl) taglineEl.textContent = this.getAttribute("tagline") ?? "";
  }
}

customElements.define("site-footer-custom-element", SiteFooterCustomElement);
