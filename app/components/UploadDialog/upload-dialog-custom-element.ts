/** @file Custom element for the upload dialog.
 *
 * Renders a trigger button that opens a modal for file uploads. Uses the native
 * <dialog> API (showModal() / close()) for focus trapping, Escape handling, and
 * ::backdrop. The dialog is appended to the element's shadow root so IDs stay
 * scoped. Before submit, a file list shows selected file names and sizes; each
 * row can be removed. ID3 metadata (artist, album, title, track number, cover
 * art) is shown per file when available. Uses heroicons-style SVGs for plus,
 * close, and remove.
 */

import "../../icons/plus-circle/index.ts";
import "../../icons/trash/index.ts";
import "../../icons/x-mark/index.ts";
import "./upload-dialog-file-item-custom-element.ts";
import type { UploadDialogFileItemCustomElement } from "./upload-dialog-file-item-custom-element.ts";

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
      width: 100%;
      height: 100%;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0;
      color: inherit;
    }
    button:focus {
      outline: none;
    }
    #trigger plus-circle-icon {
      width: 1.5rem;
      height: 1.5rem;
      display: block;
    }
  </style>
  <button type="button" aria-label="add files" id="trigger" title="Add files">
    <plus-circle-icon class="size-6"></plus-circle-icon>
  </button>
`;

const dialogTemplate = document.createElement("template");
dialogTemplate.innerHTML = `
  <style>
    dialog {
      margin: 0 auto;
      max-width: min(32rem, 90vw);
      width: 100%;
      position: relative;
      font-family: inherit;
      color: #fff;
      background: transparent;
      border: none;
      padding: 0;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
    }
    .upload-dialog-box {
      background: #121212;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      padding: 1.25rem 1.5rem;
      overflow: hidden;
    }
    .upload-dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .upload-dialog-title {
      font-size: var(--text-lg, 1.125rem);
      font-weight: 500;
      margin: 0;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .upload-dialog-close-btn {
      flex-shrink: 0;
      margin-left: auto;
      background: transparent;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0.5rem;
      border-radius: 0.25rem;
      transition: background var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1));
      width: auto;
    }
    .upload-dialog-close-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .upload-dialog-close-btn:focus {
      outline: none;
    }
    .upload-dialog-close-btn:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    .upload-dialog-close-btn x-mark-icon {
      width: 1rem;
      height: 1rem;
      display: block;
    }
    .upload-dialog-body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 0;
    }
    .upload-dialog-drop-zone {
      position: relative;
      display: block;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.05);
      border: 2px dashed rgba(255, 255, 255, 0.2);
      border-radius: 0.5rem;
      text-align: center;
      cursor: pointer;
      transition: border-color var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1)),
        background var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1));
    }
    .upload-dialog-drop-zone:hover {
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.08);
    }
    .upload-dialog-file-input {
      position: absolute;
      inset: 0;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }
    .upload-dialog-drop-zone-primary {
      display: block;
      font-size: var(--text-base, 1rem);
      font-weight: 500;
    }
    .upload-dialog-file-label {
      display: block;
      font-size: var(--text-sm, 0.875rem);
      color: rgba(255, 255, 255, 0.65);
      margin-top: 0.375rem;
    }
    .upload-dialog-footer {
      margin-top: 1.5rem;
      display: flex;
      justify-content: flex-end;
    }
    .upload-dialog-submit {
      padding: 0.625rem 1.5rem;
      background: var(--color-blue-500, #3b82f6);
      color: #fff;
      border: none;
      border-radius: 0.5rem;
      cursor: pointer;
      font-family: inherit;
      font-size: 1rem;
      font-weight: 500;
      transition: background var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1)),
        transform var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1));
    }
    .upload-dialog-submit:hover:not(:disabled) {
      background: color-mix(in oklch, var(--color-blue-500, #3b82f6) 85%, white);
    }
    .upload-dialog-submit:active:not(:disabled) {
      transform: scale(0.98);
    }
    .upload-dialog-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .upload-dialog-submit:focus {
      outline: none;
    }
    .upload-dialog-submit:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    @keyframes upload-dialog-spin {
      to { transform: rotate(360deg); }
    }
    .upload-dialog-loading {
      display: inline-block;
      width: 1rem;
      height: 1rem;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: upload-dialog-spin 0.6s linear infinite;
      vertical-align: middle;
    }
    @media (prefers-reduced-motion: reduce) {
      .upload-dialog-loading {
        animation: none;
      }
      .upload-dialog-submit:active:not(:disabled) {
        transform: none;
      }
    }
    .upload-dialog-file-list {
      list-style: none;
      margin: 0;
      padding: 0;
      padding-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      max-height: 12rem;
      overflow-y: auto;
    }
    .upload-dialog-file-list upload-dialog-file-item {
      display: grid;
    }
    .upload-dialog-error {
      padding: 0.75rem 1rem;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 0.5rem;
      color: #fca5a5;
      font-size: var(--text-sm, 0.875rem);
    }
    .upload-dialog-error[hidden] {
      display: none;
    }
  </style>
  <form method="post" enctype="multipart/form-data" id="upload-form">
    <div class="upload-dialog-box">
      <div class="upload-dialog-header">
        <h2 class="upload-dialog-title" id="upload-dialog-title">Upload files</h2>
        <button class="upload-dialog-close-btn" type="button" id="close-btn" aria-label="close"><x-mark-icon class="size-4"></x-mark-icon></button>
      </div>
      <div class="upload-dialog-body">
        <div class="upload-dialog-drop-zone">
          <input
            id="files"
            type="file"
            name="files"
            multiple
            accept="audio/*"
            class="upload-dialog-file-input"
          />
          <span class="upload-dialog-drop-zone-primary" aria-hidden="true">Choose files</span>
          <span class="upload-dialog-file-label" id="file-label">No files selected</span>
        </div>
        <div id="file-list" class="upload-dialog-file-list" role="list" aria-label="Selected files"></div>
        <div id="upload-error" class="upload-dialog-error" role="alert" aria-live="polite" hidden></div>
      </div>
      <div class="upload-dialog-footer">
        <button
          type="submit"
          id="submit-btn"
          class="upload-dialog-submit"
        >
          Upload
        </button>
      </div>
    </div>
  </form>
`;

// ELEMENT ////////////////////////////////////////////////////////////////////

/**
 * Custom element for the upload dialog.
 *
 * Provides a trigger button that opens a native `<dialog>` modal for selecting
 * and uploading audio files. The dialog is appended to the shadow root so IDs
 * stay scoped. Before submit, selected files are listed with name, size, and
 * editable ID3 metadata (artist, album, title, track number, cover art). Each
 * file row can be removed before upload. On successful submit, redirects to `/`.
 *
 * @customElement upload-dialog-custom-element
 *
 * @example
 * ```html
 * <upload-dialog-custom-element></upload-dialog-custom-element>
 * ```
 *
 * @example
 * ```html
 * <upload-dialog-custom-element
 *   buttonStyle="color: white; font-size: 1.5rem;">
 * </upload-dialog-custom-element>
 * ```
 *
 * ## Attributes
 *
 * ### `buttonStyle` (string)
 * Inline CSS applied directly to the trigger button element. Use to override
 * the default button appearance (size, color, etc.).
 *
 * ### `class` (string)
 * CSS class list applied to the host element. Standard HTML attribute.
 */
export class UploadDialogCustomElement extends HTMLElement {
  static observedAttributes = ["class", "buttonStyle"];

  #showUploadUI = false;
  #isSubmitting = false;
  /** Selected files drive the list and submit; single source of truth. */
  #selectedFiles: File[] = [];
  #dialog: HTMLDialogElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.appendChild(template.content.cloneNode(true));
  }

  connectedCallback() {
    const trigger = this.shadowRoot!.getElementById("trigger");
    if (trigger) {
      trigger.addEventListener("click", this.#onTriggerClick);
    }

    if (trigger && this.hasAttribute("buttonStyle")) {
      const buttonStyle = this.getAttribute("buttonStyle");
      if (buttonStyle) {
        trigger.style.cssText = buttonStyle;
      }
    }
  }

  disconnectedCallback() {
    const trigger = this.shadowRoot?.getElementById("trigger");
    if (trigger) {
      trigger.removeEventListener("click", this.#onTriggerClick);
    }
    this.#close();
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string,
    _newValue: string,
  ) {
    if (name === "buttonStyle") {
      const trigger = this.shadowRoot?.getElementById("trigger");
      if (trigger) {
        const buttonStyle = this.getAttribute("buttonStyle");
        trigger.style.cssText = buttonStyle ?? "";
      }
    }
  }

  #onTriggerClick = () => {
    this.#showUploadUI = true;
    this.#selectedFiles = [];
    this.#isSubmitting = false;
    this.#renderDialog();
  };

  /** Hide modal and cleanup. Called from dialog 'close' event (Escape, close button, backdrop). */
  #close() {
    this.#showUploadUI = false;
    this.#selectedFiles = [];
    this.#isSubmitting = false;
    if (this.#dialog?.parentNode) {
      this.#dialog.parentNode.removeChild(this.#dialog);
    }
    this.#dialog = null;
  }

  #renderDialog() {
    if (!this.#showUploadUI || this.#dialog) return;

    const dialog = document.createElement("dialog");
    this.#dialog = dialog;
    dialog.appendChild(dialogTemplate.content.cloneNode(true));

    this.shadowRoot!.appendChild(dialog);
    dialog.showModal();

    dialog.addEventListener("close", () => {
      this.#close();
    });

    const form = dialog.querySelector("#upload-form") as HTMLFormElement;
    const closeBtn = dialog.querySelector("#close-btn") as HTMLButtonElement;
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const fileLabel = dialog.querySelector("#file-label") as HTMLSpanElement;
    const fileListEl = dialog.querySelector("#file-list") as HTMLElement;
    const submitBtn = dialog.querySelector(
      "#submit-btn",
    ) as HTMLButtonElement;

    const updateFileLabel = () => {
      if (!fileLabel) return;
      const count = this.#selectedFiles.length;
      if (count === 0) {
        fileLabel.textContent = "No files selected";
      } else if (count === 1) {
        fileLabel.textContent = this.#selectedFiles[0].name;
      } else {
        fileLabel.textContent = `${count} files selected`;
      }
    };

    let allMetadataReady = false;
    let metadataReadyVersion = 0;

    const refreshMetadataReadyState = () => {
      const items = fileListEl?.querySelectorAll(
        "upload-dialog-file-item",
      ) as NodeListOf<UploadDialogFileItemCustomElement>;
      if (!items || items.length === 0) {
        allMetadataReady = true;
        updateSubmitState();
        return;
      }
      allMetadataReady = false;
      updateSubmitState();
      const version = ++metadataReadyVersion;
      Promise.all(Array.from(items).map((item) => item.metadataReady)).then(
        () => {
          if (version !== metadataReadyVersion) return;
          allMetadataReady = true;
          updateSubmitState();
        },
      );
    };

    const updateSubmitState = () => {
      if (submitBtn) {
        const disabled = this.#isSubmitting ||
          this.#selectedFiles.length === 0 ||
          !allMetadataReady;
        submitBtn.disabled = disabled;
        submitBtn.innerHTML = this.#isSubmitting
          ? '<span class="upload-dialog-loading" aria-hidden="true"></span>'
          : "Upload";
      }
      if (fileInput) {
        fileInput.disabled = this.#isSubmitting;
      }
    };

    const handleRemove = (e: Event) => {
      const item = e.target as HTMLElement;
      const parent = item.parentElement;
      if (!parent) return;
      const index = Array.from(parent.children).indexOf(item);
      if (index >= 0 && index < this.#selectedFiles.length) {
        this.#selectedFiles = this.#selectedFiles.filter((_, i) => i !== index);
        parent.removeChild(item);
      }
      updateFileLabel();
      refreshMetadataReadyState();
    };

    const updateFileList = () => {
      if (!fileListEl) return;
      fileListEl.replaceChildren();
      for (const file of this.#selectedFiles) {
        const item = document.createElement(
          "upload-dialog-file-item",
        ) as UploadDialogFileItemCustomElement;
        item.file = file;
        fileListEl.appendChild(item);
      }
    };

    const clearError = () => {
      const errorEl = dialog.querySelector("#upload-error") as HTMLElement;
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
    };

    const showError = (message: string) => {
      const errorEl = dialog.querySelector("#upload-error") as HTMLElement;
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      }
    };

    fileListEl?.addEventListener("upload-dialog-remove", handleRemove);

    updateSubmitState();
    updateFileLabel();
    updateFileList();

    closeBtn?.addEventListener("click", () => {
      dialog.close();
    });

    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        dialog.close();
      }
    });

    fileInput?.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        clearError();
        this.#selectedFiles = Array.from(fileInput.files);
        fileInput.value = "";
        updateFileLabel();
        updateFileList();
        refreshMetadataReadyState();
      }
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      this.#isSubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML =
          '<span class="upload-dialog-loading" aria-hidden="true"></span>';
      }
      if (fileInput) fileInput.disabled = true;

      const fileItems = fileListEl?.querySelectorAll(
        "upload-dialog-file-item",
      ) as NodeListOf<UploadDialogFileItemCustomElement>;
      await Promise.all(
        Array.from(fileItems ?? []).map((item) => item.metadataReady),
      );

      const formData = new FormData();
      for (let i = 0; i < this.#selectedFiles.length; i++) {
        formData.append("files", this.#selectedFiles[i]);
        const item = fileItems?.[i];
        if (item?.metadata) {
          formData.append(`metadata:${i}`, JSON.stringify(item.metadata));
        }
      }

      try {
        const response = await fetch("/", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          globalThis.location.href = "/";
        } else {
          const errorText = await response.text();
          const message = errorText.trim() || response.statusText ||
            "Upload failed";
          showError(message);
          console.error("Upload failed:", response.statusText);
          this.#isSubmitting = false;
          if (this.#dialog?.isConnected) updateSubmitState();
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Network error. Please check your connection and try again.";
        showError(message);
        console.error("Upload error:", error);
        this.#isSubmitting = false;
        if (this.#dialog?.isConnected) updateSubmitState();
      }
    });
  }
}

customElements.define(
  "upload-dialog-custom-element",
  UploadDialogCustomElement,
);
