/** @file Custom element for track progress / scrub bar in the playbar */

// TEMPLATE ///////////////////////////////////////////////////////////////////

const template = document.createElement("template");

template.innerHTML = `
  <style>
    :host {
      display: block;
      width: 100%;
      --progress-height: 4px;
      --progress-height-hover: 6px;
      --progress-track: #333;
      --progress-track-hover: #444;
      --progress-fill: #555;
      --progress-fill-hover: #666;
    }
    .progress-wrap {
      width: 100%;
      height: var(--progress-height);
      cursor: pointer;
      position: relative;
      touch-action: none;
      transition: height 0.15s ease;
    }
    .progress-wrap:hover,
    .progress-wrap:focus-within {
      height: var(--progress-height-hover);
    }
    .progress-track {
      position: absolute;
      inset: 0;
      background: var(--progress-track);
      border-radius: 2px;
      transition: background 0.15s ease;
    }
    .progress-wrap:hover .progress-track,
    .progress-wrap:focus-within .progress-track {
      background: var(--progress-track-hover);
    }
    .progress-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      background: var(--progress-fill);
      border-radius: 2px;
      pointer-events: none;
      transition: background 0.15s ease;
    }
    .progress-wrap:hover .progress-fill,
    .progress-wrap:focus-within .progress-fill {
      background: var(--progress-fill-hover);
    }
  </style>
  <div class="progress-wrap" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Track position">
    <div class="progress-track"></div>
    <div class="progress-fill"></div>
  </div>
`;

/**
 * Custom element for track progress and seeking.
 *
 * Renders a thin scrub bar that fills proportionally to `data-current-time /
 * data-duration`. Supports click, drag (pointer capture), and keyboard
 * (Arrow keys, Home, End) seeking. Dispatches a `seek` event with the
 * requested time in seconds. The bar expands slightly on hover/focus for
 * easier interaction.
 *
 * @customElement progress-indicator-custom-element
 *
 * @example
 * ```html
 * <progress-indicator-custom-element
 *   data-current-time="42"
 *   data-duration="180">
 * </progress-indicator-custom-element>
 * ```
 *
 * @example
 * ```typescript
 * const progress = document.querySelector('progress-indicator-custom-element');
 * progress.addEventListener('seek', (e: CustomEvent) => {
 *   audio.currentTime = e.detail.time;
 * });
 * ```
 *
 * ## Attributes
 *
 * ### `data-current-time` (string)
 * Current playback position in seconds. Parsed as a float; invalid or missing
 * values are treated as `0`.
 *
 * ### `data-duration` (string)
 * Total track duration in seconds. Parsed as a float; `0` or invalid values
 * disable seeking and render an empty bar.
 *
 * ## Events
 *
 * ### `seek`
 * Dispatched when the user clicks, drags, or uses keyboard to seek.
 * Bubbles and is composed.
 *
 * **Event detail:**
 * ```typescript
 * { time: number } // Requested playback position in seconds
 * ```
 */
export class ProgressIndicatorCustomElement extends HTMLElement {
  static observedAttributes = ["data-current-time", "data-duration"];

  private boundHandlePointerDown: (e: Event) => void;
  private boundHandlePointerMove: (e: Event) => void;
  private boundHandlePointerUp: (e: Event) => void;
  private boundHandleKeyDown: (e: Event) => void;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
    this.boundHandlePointerDown = this.handlePointerDown.bind(this);
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandlePointerUp = this.handlePointerUp.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
  }

  connectedCallback() {
    const wrap = this.shadowRoot!.querySelector(".progress-wrap");
    if (wrap) {
      wrap.addEventListener("pointerdown", this.boundHandlePointerDown);
      wrap.addEventListener("keydown", this.boundHandleKeyDown);
    }
    this.render();
  }

  disconnectedCallback() {
    const wrap = this.shadowRoot?.querySelector(".progress-wrap");
    if (wrap) {
      wrap.removeEventListener("pointerdown", this.boundHandlePointerDown);
      wrap.removeEventListener("keydown", this.boundHandleKeyDown);
    }
    document.removeEventListener("pointermove", this.boundHandlePointerMove);
    document.removeEventListener("pointerup", this.boundHandlePointerUp);
  }

  attributeChangedCallback(
    _name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ) {
    this.render();
  }

  private get currentTime(): number {
    const v = this.getAttribute("data-current-time");
    const n = v === null || v === "" ? 0 : Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  private get duration(): number {
    const v = this.getAttribute("data-duration");
    const n = v === null || v === "" ? 0 : Number.parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private render() {
    const fill = this.shadowRoot?.querySelector(
      ".progress-fill",
    ) as HTMLElement;
    const wrap = this.shadowRoot?.querySelector(
      ".progress-wrap",
    ) as HTMLElement;
    if (!fill || !wrap) return;
    const duration = this.duration;
    const current = this.currentTime;
    const percent = duration > 0
      ? Math.min(100, (current / duration) * 100)
      : 0;
    fill.style.width = `${percent}%`;
    wrap.setAttribute("aria-valuenow", String(Math.round(percent)));
  }

  private timeFromClientX(clientX: number): number {
    const wrap = this.shadowRoot?.querySelector(
      ".progress-wrap",
    ) as HTMLElement;
    const duration = this.duration;
    if (!wrap || duration <= 0) return 0;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  private dispatchSeek(time: number) {
    this.dispatchEvent(
      new CustomEvent("seek", {
        detail: { time },
        bubbles: true,
        composed: true,
        cancelable: false,
      }),
    );
  }

  private handlePointerDown(event: Event) {
    const e = event as PointerEvent;
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    document.addEventListener("pointermove", this.boundHandlePointerMove);
    document.addEventListener("pointerup", this.boundHandlePointerUp, {
      once: true,
    });
    const time = this.timeFromClientX(e.clientX);
    this.dispatchSeek(time);
  }

  private handlePointerMove(event: Event) {
    const e = event as PointerEvent;
    const time = this.timeFromClientX(e.clientX);
    this.dispatchSeek(time);
  }

  private handlePointerUp(_event: Event) {
    document.removeEventListener("pointermove", this.boundHandlePointerMove);
  }

  private handleKeyDown(event: Event) {
    const e = event as KeyboardEvent;
    const duration = this.duration;
    if (duration <= 0) return;
    const step = 5;
    let time = this.currentTime;
    if (e.key === "ArrowLeft" || e.key === "Home") {
      e.preventDefault();
      time = e.key === "Home" ? 0 : Math.max(0, time - step);
      this.dispatchSeek(time);
    } else if (e.key === "ArrowRight" || e.key === "End") {
      e.preventDefault();
      time = e.key === "End" ? duration : Math.min(duration, time + step);
      this.dispatchSeek(time);
    }
  }
}

customElements.define(
  "progress-indicator-custom-element",
  ProgressIndicatorCustomElement,
);
