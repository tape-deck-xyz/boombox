/** @file Custom element for a single file row in the upload dialog.
 *
 * Displays file name, size, a remove button, and loads ID3 metadata (artist,
 * album, title, track, cover art) asynchronously. Artist, album, title, and
 * track number are editable. Dispatches `upload-dialog-remove` when the remove
 * button is clicked.
 */

import "../../icons/trash/index.ts";
import { formatFileSize } from "../../util/format.ts";
import {
  getID3TagsFromFile,
  type ID3TagsEditable,
} from "../../util/id3.browser.ts";

// TEMPLATE ///////////////////////////////////////////////////////////////////

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: grid;
      grid-template-columns: 1fr auto auto;
      grid-template-rows: auto auto;
      gap: 0.5rem 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: var(--text-sm, 0.875rem);
    }
    :host(:last-child) {
      border-bottom: none;
    }
    .upload-dialog-file-item-name {
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: rgba(255, 255, 255, 0.9);
    }
    .upload-dialog-file-item-size {
      grid-column: 2;
      grid-row: 1;
      color: rgba(255, 255, 255, 0.5);
    }
    .upload-dialog-file-item-remove {
      grid-column: 3;
      grid-row: 1;
      align-self: start;
      background: transparent;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 0.25rem;
      transition: background var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1));
    }
    .upload-dialog-file-item-remove:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .upload-dialog-file-item-remove:focus {
      outline: none;
    }
    .upload-dialog-file-item-remove:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .upload-dialog-file-item-remove {
        transition: none;
      }
    }
    .upload-dialog-file-item-remove trash-icon {
      width: 1rem;
      height: 1rem;
      display: block;
    }
    .upload-dialog-file-item-id3 {
      grid-column: 1 / -1;
      grid-row: 2;
      min-width: 0;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.6);
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .upload-dialog-file-item-id3 img {
      width: 2.5rem;
      height: 2.5rem;
      object-fit: cover;
      border-radius: 0.25rem;
      flex-shrink: 0;
    }
    .upload-dialog-file-item-id3-fields {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 0;
      flex: 1;
    }
    .upload-dialog-file-item-id3-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .upload-dialog-file-item-id3-row label {
      flex-shrink: 0;
      width: 3.5rem;
      color: rgba(255, 255, 255, 0.65);
    }
    .upload-dialog-file-item-id3-row input {
      flex: 1;
      min-width: 0;
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 0.25rem;
      color: inherit;
      font-family: inherit;
    }
    .upload-dialog-file-item-id3-row input:focus {
      outline: none;
    }
    .upload-dialog-file-item-id3-row input:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    .upload-dialog-file-item-id3-row input[type="number"] {
      width: 3.5rem;
      flex: none;
    }
  </style>
  <span class="upload-dialog-file-item-name" id="name"></span>
  <span class="upload-dialog-file-item-size" id="size"></span>
  <button type="button" class="upload-dialog-file-item-remove" id="remove" aria-label="Remove">
    <trash-icon class="size-4"></trash-icon>
  </button>
  <div class="upload-dialog-file-item-id3" id="id3-target">Loading…</div>
`;

// ELEMENT ////////////////////////////////////////////////////////////////////

/**
 * Custom element for a single file row in the upload dialog file list.
 *
 * Displays the file name, size, and editable ID3 metadata fields (artist,
 * album, title, track number, cover art). Metadata is loaded asynchronously
 * from the file's ID3 tags. Fields are pre-populated with tag values and
 * remain editable; the `metadata` property always reflects the current
 * field values. Dispatches `upload-dialog-remove` when the remove button
 * is clicked. Intended for use only inside `upload-dialog-custom-element`.
 *
 * @customElement upload-dialog-file-item
 *
 * @example
 * ```typescript
 * const item = document.createElement('upload-dialog-file-item')
 *   as UploadDialogFileItemCustomElement;
 * item.file = selectedFile;
 * fileList.appendChild(item);
 *
 * // Wait for ID3 metadata to finish loading before reading it
 * await item.metadataReady;
 * console.log(item.metadata); // { artist, album, title, trackNumber }
 * ```
 *
 * ## Properties
 *
 * ### `file` (File | null)
 * Set this property to populate the row. Setting a new file resets metadata
 * and starts a fresh ID3 load. Setting `null` clears the row.
 *
 * ### `metadataReady` (Promise\<void\>)
 * Resolves when ID3 metadata has finished loading (or failed). Await this
 * before reading `metadata` to ensure values are populated.
 *
 * ### `metadata` (ID3TagsEditable)
 * Current editable metadata reflecting the user's input. Returns a copy.
 *
 * ### `fileKey` (string)
 * Stable identifier for the file: `"{name}-{size}-{lastModified}"`.
 *
 * ## Events
 *
 * ### `upload-dialog-remove`
 * Dispatched when the remove button is clicked. Bubbles.
 *
 * **Event detail:**
 * ```typescript
 * { fileKey: string } // Stable key identifying the file to remove
 * ```
 */
export class UploadDialogFileItemCustomElement extends HTMLElement {
  #file: File | null = null;
  #fileKey = "";
  #metadata: ID3TagsEditable = {
    artist: "",
    album: "",
    title: "",
    trackNumber: 1,
  };
  #id3InputUnsubscribe: (() => void)[] = [];
  #metadataReadyResolve: (() => void) | null = null;
  #metadataReadyPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
  }

  connectedCallback() {
    this.setAttribute("role", "listitem");
    const removeBtn = this.shadowRoot!.getElementById("remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", this.#onRemoveClick);
    }
  }

  disconnectedCallback() {
    const removeBtn = this.shadowRoot?.getElementById("remove");
    if (removeBtn) {
      removeBtn.removeEventListener("click", this.#onRemoveClick);
    }
    for (const fn of this.#id3InputUnsubscribe) fn();
    this.#id3InputUnsubscribe = [];
  }

  /**
   * The file to display. When set, updates the UI and starts ID3 loading.
   */
  get file(): File | null {
    return this.#file;
  }

  set file(value: File | null) {
    this.#file = value;
    if (value) {
      this.#fileKey = `${value.name}-${value.size}-${value.lastModified}`;
      this.#metadataReadyPromise = new Promise<void>((resolve) => {
        this.#metadataReadyResolve = resolve;
      });
      this.#render(value);
    } else {
      this.#metadataReadyPromise = Promise.resolve();
    }
  }

  /** Resolves when ID3 metadata has finished loading (or failed). Use before submit. */
  get metadataReady(): Promise<void> {
    return this.#metadataReadyPromise;
  }

  /** Stable key for this file (name-size-lastModified). */
  get fileKey(): string {
    return this.#fileKey;
  }

  /** Current editable metadata (for upload dialog to collect on submit). */
  get metadata(): ID3TagsEditable {
    return { ...this.#metadata };
  }

  #onRemoveClick = () => {
    this.dispatchEvent(
      new CustomEvent("upload-dialog-remove", {
        bubbles: true,
        detail: { fileKey: this.#fileKey },
      }),
    );
  };

  #syncMetadataFromInputs(
    artistInput: HTMLInputElement,
    albumInput: HTMLInputElement,
    titleInput: HTMLInputElement,
    trackInput: HTMLInputElement,
  ) {
    this.#metadata = {
      artist: artistInput.value.trim(),
      album: albumInput.value.trim(),
      title: titleInput.value.trim(),
      trackNumber: Math.max(1, parseInt(trackInput.value, 10) || 1),
    };
  }

  #render(file: File) {
    const nameEl = this.shadowRoot!.getElementById("name");
    const sizeEl = this.shadowRoot!.getElementById("size");
    const id3Target = this.shadowRoot!.getElementById("id3-target");
    const removeBtn = this.shadowRoot!.getElementById("remove");

    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) sizeEl.textContent = formatFileSize(file.size);
    if (removeBtn) removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
    if (id3Target) id3Target.textContent = "Loading…";

    for (const fn of this.#id3InputUnsubscribe) fn();
    this.#id3InputUnsubscribe = [];

    getID3TagsFromFile(file)
      .then((tags) => {
        if (!this.isConnected || !id3Target) return;
        id3Target.replaceChildren();

        // Use "Unknown" when ID3 fails or returns null (non-MP3, parse error).
        // Empty strings would override server defaults on upload and produce invalid
        // S3 keys (//1__) that file listing skips (!artist || !album)
        const artist = tags?.artist?.trim() || "Unknown";
        const album = tags?.album?.trim() || "Unknown";
        const title = tags?.title?.trim() || "Unknown";
        const trackNumber = Math.max(1, tags?.trackNumber ?? 1);
        const image = tags?.image;

        this.#metadata = { artist, album, title, trackNumber };

        const wrapper = document.createElement("div");
        wrapper.className = "upload-dialog-file-item-id3";

        if (image) {
          const img = document.createElement("img");
          img.src = image;
          img.alt = "";
          img.setAttribute("aria-hidden", "true");
          wrapper.appendChild(img);
        }

        const fields = document.createElement("div");
        fields.className = "upload-dialog-file-item-id3-fields";

        const artistRow = document.createElement("div");
        artistRow.className = "upload-dialog-file-item-id3-row";
        const artistLabel = document.createElement("label");
        artistLabel.htmlFor = "artist-input";
        artistLabel.textContent = "Artist";
        const artistInput = document.createElement("input");
        artistInput.id = "artist-input";
        artistInput.type = "text";
        artistInput.value = artist;
        artistInput.setAttribute("aria-label", "Artist");
        artistRow.appendChild(artistLabel);
        artistRow.appendChild(artistInput);
        fields.appendChild(artistRow);

        const albumRow = document.createElement("div");
        albumRow.className = "upload-dialog-file-item-id3-row";
        const albumLabel = document.createElement("label");
        albumLabel.htmlFor = "album-input";
        albumLabel.textContent = "Album";
        const albumInput = document.createElement("input");
        albumInput.id = "album-input";
        albumInput.type = "text";
        albumInput.value = album;
        albumInput.setAttribute("aria-label", "Album");
        albumRow.appendChild(albumLabel);
        albumRow.appendChild(albumInput);
        fields.appendChild(albumRow);

        const titleRow = document.createElement("div");
        titleRow.className = "upload-dialog-file-item-id3-row";
        const titleLabel = document.createElement("label");
        titleLabel.htmlFor = "title-input";
        titleLabel.textContent = "Title";
        const titleInput = document.createElement("input");
        titleInput.id = "title-input";
        titleInput.type = "text";
        titleInput.value = title;
        titleInput.setAttribute("aria-label", "Title");
        titleRow.appendChild(titleLabel);
        titleRow.appendChild(titleInput);
        fields.appendChild(titleRow);

        const trackRow = document.createElement("div");
        trackRow.className = "upload-dialog-file-item-id3-row";
        const trackLabel = document.createElement("label");
        trackLabel.htmlFor = "track-number-input";
        trackLabel.textContent = "Track";
        const trackInput = document.createElement("input");
        trackInput.id = "track-number-input";
        trackInput.type = "number";
        trackInput.min = "1";
        trackInput.value = String(trackNumber);
        trackInput.setAttribute("aria-label", "Track number");
        trackRow.appendChild(trackLabel);
        trackRow.appendChild(trackInput);
        fields.appendChild(trackRow);

        const sync = () =>
          this.#syncMetadataFromInputs(
            artistInput,
            albumInput,
            titleInput,
            trackInput,
          );

        const onInput = () => sync();
        artistInput.addEventListener("input", onInput);
        albumInput.addEventListener("input", onInput);
        titleInput.addEventListener("input", onInput);
        trackInput.addEventListener("input", onInput);

        this.#id3InputUnsubscribe.push(() => {
          artistInput.removeEventListener("input", onInput);
          albumInput.removeEventListener("input", onInput);
          titleInput.removeEventListener("input", onInput);
          trackInput.removeEventListener("input", onInput);
        });

        wrapper.appendChild(fields);
        id3Target.appendChild(wrapper);
      })
      .finally(() => {
        this.#metadataReadyResolve?.();
        this.#metadataReadyResolve = null;
      });
  }
}

customElements.define(
  "upload-dialog-file-item",
  UploadDialogFileItemCustomElement,
);
