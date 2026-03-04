/** @file Tests for UploadDialogCustomElement
 *
 * Covers the upload-dialog custom element: trigger button, modal open/close,
 * file selection, file list with remove, submit with fetch, and error handling.
 *
 * Uses linkedom for a real DOM environment; wires document/window to globalThis
 * so the component can run in Deno.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import {
  createCustomElement,
  createLinkedomEnv,
  wireLinkedomToGlobal,
} from "../test.utils.ts";

const { document: linkedomDocument, window: linkedomWindow } =
  createLinkedomEnv();

function setupDOMEnvironment(options?: {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  wireLinkedomToGlobal(linkedomWindow, linkedomDocument, {
    event: true,
    fetch: options?.fetch ??
      (() =>
        Promise.resolve(
          new Response(null, { status: 303, headers: { Location: "/" } }),
        )),
  });

  // Polyfill dialog for linkedom: patch createElement so dialogs have showModal/close
  const origCreateElement = linkedomDocument.createElement.bind(
    linkedomDocument,
  );
  linkedomDocument.createElement = function (
    this: Document,
    tagName: string,
  ): HTMLElement {
    const el = origCreateElement(tagName);
    if (tagName.toLowerCase() === "dialog") {
      const d = el as HTMLDialogElement & { showModal?: () => void };
      if (typeof d.showModal !== "function") d.showModal = () => {};
      if (typeof d.close !== "function") {
        d.close = function (this: Element) {
          this.dispatchEvent(
            new linkedomWindow.Event("close", { bubbles: true }),
          );
        };
      }
    }
    return el as HTMLElement;
  };

  // Mock location for redirect on success (upload dialog sets location.href)
  const locationMock = { href: "http://localhost:8000/" };
  (globalThis as { location: Location }).location =
    locationMock as unknown as Location;
}

function createUploadDialog(
  attrs: Record<string, string> = {},
): HTMLElement {
  return createCustomElement(
    linkedomDocument,
    "upload-dialog-custom-element",
    attrs,
  );
}

function getTrigger(el: HTMLElement): HTMLButtonElement | null {
  return el.shadowRoot?.getElementById("trigger") as HTMLButtonElement | null;
}

function getDialog(el: HTMLElement): HTMLDialogElement | null {
  return el.shadowRoot?.querySelector("dialog") as HTMLDialogElement | null;
}

function clickTrigger(el: HTMLElement): void {
  const trigger = getTrigger(el);
  assertExists(trigger, "trigger button should exist");
  trigger.click();
}

/** Creates a FileList-like object from files (Deno has no DataTransfer). */
function createFileList(files: File[]): FileList {
  const list = [...files] as unknown as FileList;
  list.item = (i: number) => files[i] ?? null;
  return list;
}

/** Simulates file selection on the file input. */
function setFileInputFiles(
  fileInput: HTMLInputElement,
  files: File[],
): void {
  Object.defineProperty(fileInput, "files", {
    value: createFileList(files),
    configurable: true,
    writable: true,
  });
  fileInput.dispatchEvent(
    new linkedomWindow.Event("change", { bubbles: true }),
  );
}

// ============================================================================
// TESTS
// ============================================================================

Deno.test("UploadDialogCustomElement - element can be created", async () => {
  setupDOMEnvironment();
  const { UploadDialogCustomElement } = await import(
    "./upload-dialog-custom-element.ts"
  );

  const element = new UploadDialogCustomElement();
  assertExists(element);
  assertEquals(element.constructor.name, "UploadDialogCustomElement");
});

Deno.test(
  "UploadDialogCustomElement - creates shadow root with trigger button",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    assertExists(el.shadowRoot);
    const trigger = getTrigger(el);
    assertExists(trigger);
  },
);

Deno.test(
  "UploadDialogCustomElement - observedAttributes includes class and buttonStyle",
  async () => {
    setupDOMEnvironment();
    const { UploadDialogCustomElement } = await import(
      "./upload-dialog-custom-element.ts"
    );

    assertEquals(
      UploadDialogCustomElement.observedAttributes.includes("class"),
      true,
    );
    assertEquals(
      UploadDialogCustomElement.observedAttributes.includes("buttonStyle"),
      true,
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - attributeChangedCallback applies buttonStyle to trigger",
  async () => {
    setupDOMEnvironment();
    const { UploadDialogCustomElement } = await import(
      "./upload-dialog-custom-element.ts"
    );

    const element = new UploadDialogCustomElement();
    linkedomDocument.body?.appendChild(element);
    const trigger = getTrigger(element) as HTMLButtonElement & {
      style: { cssText: string };
    };
    assertExists(trigger);
    assertExists(trigger.style);

    element.setAttribute("buttonStyle", "width: 100px; height: 50px");
    element.attributeChangedCallback(
      "buttonStyle",
      "",
      "width: 100px; height: 50px",
    );
    assertStringIncludes(
      trigger.style.cssText,
      "100px",
      "trigger style should include width/height from buttonStyle attribute",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - open() shows dialog programmatically",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog() as HTMLElement & { open: () => void };
    el.open();
    const dialog = getDialog(el);
    assertExists(dialog, "dialog should exist after open()");
  },
);

Deno.test(
  "UploadDialogCustomElement - upload-dialog-open event opens dialog",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    document.dispatchEvent(new CustomEvent("upload-dialog-open"));
    const dialog = getDialog(el);
    assertExists(dialog, "dialog should exist after upload-dialog-open event");
  },
);

Deno.test(
  "UploadDialogCustomElement - dialog close removes it from shadow root",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog, "dialog should exist after trigger click");
    assertExists(
      typeof dialog.close === "function",
      "dialog should have close()",
    );
    dialog.close();
    const dialogAfter = el.shadowRoot?.querySelector("dialog");
    assertEquals(
      dialogAfter,
      null,
      "dialog should be removed from shadow root when closed",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - backdrop click closes the dialog",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    dialog.dispatchEvent(new linkedomWindow.Event("click", { bubbles: true }));
    const dialogAfter = el.shadowRoot?.querySelector("dialog");
    assertEquals(
      dialogAfter,
      null,
      "dialog should be removed from shadow root on backdrop click",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - dialog markup includes styling and title",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const html = dialog.innerHTML;
    assert(
      html.includes("Upload files"),
      "dialog markup should include title 'Upload files'",
    );
    assert(
      html.includes("box-shadow"),
      "dialog markup should include box-shadow in styles",
    );
    assert(
      html.includes("focus-visible"),
      "dialog markup should include focus-visible in styles",
    );
    assert(
      html.includes("--color-blue-500") || html.includes("#3b82f6"),
      "dialog markup should include primary button color",
    );
    assert(
      html.includes('id="upload-error"'),
      "dialog markup should include upload-error element",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - file input restricts to audio uploads",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    assertExists(fileInput);
    assertEquals(
      fileInput.getAttribute("accept"),
      "audio/*",
      "file input should have accept=audio/*",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - file list updated when files selected",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const fileListEl = dialog.querySelector("#file-list");
    assertExists(fileInput);
    assertExists(fileListEl);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    const fileItems = fileListEl.querySelectorAll("upload-dialog-file-item");
    assertEquals(
      fileItems.length,
      1,
      "file list should have one item after selecting one file",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - remove file updates list and disables submit",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const fileListEl = dialog.querySelector("#file-list");
    const submitBtn = dialog.querySelector("#submit-btn") as HTMLButtonElement;
    assertExists(fileInput);
    assertExists(fileListEl);
    assertExists(submitBtn);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    let fileItems = fileListEl.querySelectorAll("upload-dialog-file-item");
    assertEquals(fileItems.length, 1);

    const removeBtn = fileItems[0]?.shadowRoot?.getElementById("remove");
    assertExists(removeBtn);
    removeBtn.click();

    fileItems = fileListEl.querySelectorAll("upload-dialog-file-item");
    assertEquals(
      fileItems.length,
      0,
      "file list should be empty after remove",
    );
    assert(
      submitBtn.disabled,
      "submit should be disabled when no files remain",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - removing one of two duplicate-key files removes only that one",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const fileListEl = dialog.querySelector("#file-list");
    const submitBtn = dialog.querySelector("#submit-btn") as HTMLButtonElement;
    assertExists(fileInput);
    assertExists(fileListEl);
    assertExists(submitBtn);

    const file1 = new File(["a"], "dup.mp3", {
      type: "audio/mpeg",
      lastModified: 11111,
    });
    const file2 = new File(["b"], "dup.mp3", {
      type: "audio/mpeg",
      lastModified: 11111,
    });
    Object.defineProperty(file1, "size", { value: 1024 });
    Object.defineProperty(file2, "size", { value: 1024 });
    setFileInputFiles(fileInput, [file1, file2]);

    let fileItems = fileListEl.querySelectorAll("upload-dialog-file-item");
    assertEquals(fileItems.length, 2, "should have two file items");

    const firstRemoveBtn = fileItems[0]?.shadowRoot?.getElementById("remove");
    assertExists(firstRemoveBtn);
    firstRemoveBtn.click();

    fileItems = fileListEl.querySelectorAll("upload-dialog-file-item");
    assertEquals(
      fileItems.length,
      1,
      "only one item should remain after removing the first",
    );
    const remainingItem = fileItems[0] as unknown as {
      metadataReady: Promise<void>;
    };
    await remainingItem.metadataReady;
    await new Promise((r) => setTimeout(r, 0));
    assert(
      !submitBtn.disabled,
      "submit should stay enabled with one file remaining",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - submit disabled until ID3 metadata loads or fails",
  async () => {
    setupDOMEnvironment();
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const fileListEl = dialog.querySelector("#file-list");
    const submitBtn = dialog.querySelector("#submit-btn") as HTMLButtonElement;
    assertExists(fileInput);
    assertExists(fileListEl);
    assertExists(submitBtn);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    assert(
      submitBtn.disabled,
      "submit should be disabled immediately after file selection (metadata loading)",
    );

    const fileItem = fileListEl.querySelector(
      "upload-dialog-file-item",
    ) as unknown as { metadataReady: Promise<void> };
    await fileItem.metadataReady;
    await new Promise((r) => setTimeout(r, 0));
    assert(
      !submitBtn.disabled,
      "submit should be enabled after metadata loads",
    );
  },
);

Deno.test(
  "UploadDialogFileItemCustomElement - renders file name and size when file is set",
  async () => {
    setupDOMEnvironment();
    const { UploadDialogFileItemCustomElement } = await import(
      "./upload-dialog-file-item-custom-element.ts"
    );

    const element = new UploadDialogFileItemCustomElement();
    const file = new File(["content"], "test.mp3", {
      type: "audio/mpeg",
      lastModified: 12345,
    });
    Object.defineProperty(file, "size", { value: 1024 });
    element.file = file;
    linkedomDocument.body?.appendChild(element);

    const nameEl = element.shadowRoot?.getElementById("name");
    const sizeEl = element.shadowRoot?.getElementById("size");
    assertExists(nameEl);
    assertExists(sizeEl);
    assertEquals(nameEl.textContent, "test.mp3");
    assertEquals(sizeEl.textContent, "1.0 KB");
  },
);

Deno.test(
  "UploadDialogFileItemCustomElement - dispatches upload-dialog-remove when remove is clicked",
  async () => {
    setupDOMEnvironment();
    const { UploadDialogFileItemCustomElement } = await import(
      "./upload-dialog-file-item-custom-element.ts"
    );

    let capturedDetail: { fileKey: string } | null = null;
    const element = new UploadDialogFileItemCustomElement();
    const file = new File(["x"], "song.mp3", {
      type: "audio/mpeg",
      lastModified: 99999,
    });
    Object.defineProperty(file, "size", { value: 512 });
    element.file = file;
    linkedomDocument.body?.appendChild(element);
    element.addEventListener(
      "upload-dialog-remove",
      (e) => {
        capturedDetail = (e as CustomEvent<{ fileKey: string }>).detail;
      },
    );

    const removeBtn = element.shadowRoot?.getElementById("remove");
    assertExists(removeBtn);
    removeBtn.click();

    assertExists(capturedDetail);
    assertEquals(
      (capturedDetail as { fileKey: string }).fileKey,
      "song.mp3-512-99999",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - shows server error message when upload fails",
  async () => {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(
          new Response("Upload failed for all files: S3 connection error", {
            status: 500,
          }),
        ),
    });
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const form = dialog.querySelector("#upload-form") as HTMLFormElement;
    assertExists(fileInput);
    assertExists(form);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    form.dispatchEvent(
      new linkedomWindow.Event("submit", { cancelable: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const errorEl = dialog.querySelector("#upload-error") as HTMLElement;
    assertExists(errorEl);
    assertEquals(
      errorEl.textContent,
      "Upload failed for all files: S3 connection error",
      "error message from server should be shown",
    );
    assert(
      !errorEl.hidden,
      "error element should be visible when error occurs",
    );
  },
);

Deno.test(
  "UploadDialogCustomElement - shows network error message when fetch throws",
  async () => {
    setupDOMEnvironment({
      fetch: () => Promise.reject(new Error("Failed to fetch")),
    });
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const form = dialog.querySelector("#upload-form") as HTMLFormElement;
    assertExists(fileInput);
    assertExists(form);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    form.dispatchEvent(
      new linkedomWindow.Event("submit", { cancelable: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const errorEl = dialog.querySelector("#upload-error") as HTMLElement;
    assertExists(errorEl);
    assertEquals(
      errorEl.textContent,
      "Failed to fetch",
      "error message from thrown Error should be shown",
    );
    assert(!errorEl.hidden);
  },
);

Deno.test(
  "UploadDialogCustomElement - clears error when user selects new files",
  async () => {
    setupDOMEnvironment({
      fetch: () =>
        Promise.resolve(new Response("Server error", { status: 500 })),
    });
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const form = dialog.querySelector("#upload-form") as HTMLFormElement;
    assertExists(fileInput);
    assertExists(form);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    form.dispatchEvent(
      new linkedomWindow.Event("submit", { cancelable: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    let errorEl = dialog.querySelector("#upload-error") as HTMLElement;
    assertEquals(errorEl.textContent, "Server error");
    assert(!errorEl.hidden);

    const newFile = new File(["y"], "song2.mp3", { type: "audio/mpeg" });
    Object.defineProperty(newFile, "size", { value: 2048 });
    setFileInputFiles(fileInput, [newFile]);

    errorEl = dialog.querySelector("#upload-error") as HTMLElement;
    assertEquals(
      errorEl.textContent,
      "",
      "error should be cleared when user selects new files",
    );
    assert(errorEl.hidden, "error element should be hidden when cleared");
  },
);

Deno.test(
  "UploadDialogCustomElement - regression: FormData is built from selected files so fetch receives files",
  async () => {
    let capturedBody: FormData | null = null;
    setupDOMEnvironment({
      fetch: (_url: unknown, init?: RequestInit) => {
        capturedBody = (init?.body as FormData) ?? null;
        return Promise.resolve(
          new Response(null, { status: 303, headers: { Location: "/" } }),
        );
      },
    });
    await import("./upload-dialog-custom-element.ts");

    const el = createUploadDialog();
    clickTrigger(el);
    const dialog = getDialog(el);
    assertExists(dialog);
    const fileInput = dialog.querySelector("#files") as HTMLInputElement;
    const form = dialog.querySelector("#upload-form") as HTMLFormElement;
    assertExists(fileInput);
    assertExists(form);

    const mockFile = new File(["x"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 });
    setFileInputFiles(fileInput, [mockFile]);

    form.dispatchEvent(
      new linkedomWindow.Event("submit", { cancelable: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assertExists(capturedBody);
    const body = capturedBody as FormData;
    assertEquals(
      body.getAll("files").length,
      1,
      "FormData passed to fetch must include selected files",
    );
    const metadata0 = body.get("metadata:0");
    assertExists(metadata0);
    const parsed = JSON.parse(metadata0 as string) as {
      artist: string;
      album: string;
      title: string;
      trackNumber: number;
    };
    assertEquals(parsed.artist, "Unknown"); // ID3 returns null in Deno, so "Unknown"
    assertEquals(parsed.album, "Unknown");
    assertEquals(parsed.title, "Unknown");
    assertEquals(parsed.trackNumber, 1);
  },
);

Deno.test(
  "UploadDialogFileItemCustomElement - metadata getter returns editable values and trackNumber clamps to 1",
  async () => {
    setupDOMEnvironment();
    const { UploadDialogFileItemCustomElement } = await import(
      "./upload-dialog-file-item-custom-element.ts"
    );

    const element = new UploadDialogFileItemCustomElement();
    const file = new File(["x"], "track.mp3", {
      type: "audio/mpeg",
      lastModified: 11111,
    });
    Object.defineProperty(file, "size", { value: 256 });
    element.file = file;
    linkedomDocument.body?.appendChild(element);

    await new Promise((r) => setTimeout(r, 50));
    const meta = element.metadata;
    assertExists(meta);
    assertEquals(typeof meta.artist, "string");
    assertEquals(typeof meta.album, "string");
    assertEquals(typeof meta.title, "string");
    assertEquals(typeof meta.trackNumber, "number");
    assert(meta.trackNumber >= 1, "trackNumber should be at least 1");
  },
);

Deno.test(
  "UploadDialogFileItemCustomElement - metadata uses Unknown when ID3 returns null",
  async () => {
    setupDOMEnvironment();
    const { UploadDialogFileItemCustomElement } = await import(
      "./upload-dialog-file-item-custom-element.ts"
    );

    const element = new UploadDialogFileItemCustomElement();
    linkedomDocument.body?.appendChild(element);
    const file = new File(["x"], "nocover.wav", {
      type: "audio/wav",
      lastModified: 22222,
    });
    Object.defineProperty(file, "size", { value: 128 });
    element.file = file;

    await new Promise((r) => setTimeout(r, 100));
    const meta = element.metadata;
    assertEquals(meta.artist, "Unknown");
    assertEquals(meta.album, "Unknown");
    assertEquals(meta.title, "Unknown");
  },
);
