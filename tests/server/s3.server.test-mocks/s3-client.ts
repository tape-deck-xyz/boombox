/** Mock for @aws-sdk/client-s3 - mock S3Client, real commands */
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
} from "npm:@aws-sdk/client-s3@^3.614.0";

export {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
};

export const sendCalls: { command: unknown }[] = [];

/** E2E fixture: keys that produce a non-empty Files structure for index and album pages. */
const E2E_FIXTURE_KEYS = [
  { Key: "Test Artist/Test Album/1__Test Track.mp3", LastModified: new Date() },
  {
    Key: "Test Artist/Test Album/2__Another Song.mp3",
    LastModified: new Date(),
  },
  { Key: "Test Artist/Test Album/cover.jpeg", LastModified: new Date() },
];

const INFO_JSON_KEY = "info.json";

/** In-memory `info.json` for tests (persists until cleared). */
const mockInfoJsonStore: { body: string; etag: string } = {
  body: "",
  etag: "init-etag",
};

function commandKey(command: unknown): string | undefined {
  return (command as { input?: { Key?: string } }).input?.Key;
}

/** Reset mock state so S3 has no `info.json` object. */
export function resetMockInfoJsonObject(): void {
  mockInfoJsonStore.body = "";
  mockInfoJsonStore.etag = `etag-${Date.now()}`;
}

function mockInfoJsonCommand(command: unknown): Promise<unknown> | null {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  const key = commandKey(command);
  if (key !== INFO_JSON_KEY) return null;

  if (name === "PutObjectCommand") {
    const input = (command as { input?: { Body?: Uint8Array | string } }).input;
    const body = input?.Body;
    const text = typeof body === "string"
      ? body
      : body
      ? new TextDecoder().decode(body)
      : "{}";
    mockInfoJsonStore.body = text;
    mockInfoJsonStore.etag = `etag-${Date.now()}`;
    return Promise.resolve({ ETag: `"${mockInfoJsonStore.etag}"` });
  }
  if (name === "HeadObjectCommand") {
    if (!mockInfoJsonStore.body) {
      const err = new Error("NotFound");
      (err as { name: string }).name = "NotFound";
      return Promise.reject(err);
    }
    return Promise.resolve({
      ETag: `"${mockInfoJsonStore.etag}"`,
      LastModified: new Date(),
    });
  }
  if (name === "GetObjectCommand") {
    if (!mockInfoJsonStore.body) {
      return Promise.reject(
        new NoSuchKey({ $metadata: {}, message: "mock nosuchkey" }),
      );
    }
    return Promise.resolve({
      ETag: `"${mockInfoJsonStore.etag}"`,
      Body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(mockInfoJsonStore.body));
          controller.close();
        },
      }),
    });
  }
  return null;
}

type E2eSessionObject = {
  lastModified: Date;
  body: Uint8Array;
};

/** Keys written via PutObject while E2E_MODE=1; merged into ListObjectsV2 and GetObject. */
const e2eSessionKeys = new Map<string, E2eSessionObject>();

/** Matches production {@link uploadStreamToS3}: `PutObject` body is a byte buffer. */
function normalizeE2ePutBody(body: unknown): Uint8Array {
  if (body == null) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(0);
}

/**
 * Clears E2E session objects (PutObject keys recorded in E2E_MODE).
 * Call from Deno tests that mutate the session so order does not leak state.
 */
export function resetE2eS3SessionStore(): void {
  e2eSessionKeys.clear();
}

function mergedE2eListObjectsContents(): { Key: string; LastModified: Date }[] {
  const base = Deno.env.get("E2E_EMPTY") === "1" ? [] : [...E2E_FIXTURE_KEYS];
  const byKey = new Map<string, { Key: string; LastModified: Date }>();
  for (const item of base) {
    if (item.Key) {
      byKey.set(item.Key, { Key: item.Key, LastModified: item.LastModified });
    }
  }
  for (const [key, entry] of e2eSessionKeys) {
    byKey.set(key, { Key: key, LastModified: entry.lastModified });
  }
  return [...byKey.values()].sort((a, b) => a.Key.localeCompare(b.Key));
}

function keyExistsInE2eMerged(key: string): boolean {
  for (const { Key: k } of mergedE2eListObjectsContents()) {
    if (k === key) return true;
  }
  return false;
}

/** Default mock reply: canonical `info.json` first, then E2E session + fixture merge. */
export function defaultS3MockReply(command: unknown): Promise<unknown> {
  const info = mockInfoJsonCommand(command);
  if (info !== null) return info;

  const name = (command as { constructor: { name: string } }).constructor?.name;

  if (name === "PutObjectCommand") {
    if (Deno.env.get("E2E_MODE") === "1") {
      const input = (command as { input?: { Key?: string; Body?: unknown } })
        .input;
      const key = input?.Key;
      if (key) {
        const body = normalizeE2ePutBody(input?.Body);
        e2eSessionKeys.set(key, { lastModified: new Date(), body });
        return Promise.resolve({});
      }
    }
    return Promise.resolve({});
  }

  if (name === "ListObjectsV2Command" && Deno.env.get("E2E_MODE") === "1") {
    return Promise.resolve({
      Contents: mergedE2eListObjectsContents(),
      IsTruncated: false,
    });
  }

  if (name === "GetObjectCommand" && Deno.env.get("E2E_MODE") === "1") {
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (key) {
      const entry = e2eSessionKeys.get(key);
      if (entry) {
        const bytes = entry.body;
        return Promise.resolve({
          Body: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        });
      }
    }
  }

  if (name === "HeadObjectCommand") {
    if (Deno.env.get("E2E_MODE") === "1") {
      const key = (command as { input?: { Key?: string } }).input?.Key;
      if (key && keyExistsInE2eMerged(key)) {
        return Promise.resolve({});
      }
    }
    const err = new Error("NotFound");
    (err as { name: string }).name = "NotFound";
    return Promise.reject(err);
  }

  return Promise.resolve({});
}

let sendBehavior: (command: unknown) => Promise<unknown> = defaultS3MockReply;

export function setSendBehavior(
  fn: ((command: unknown) => Promise<unknown>) | null,
): void {
  sendBehavior = fn ?? defaultS3MockReply;
}

export function clearSendCalls(): void {
  sendCalls.length = 0;
}

export class S3Client {
  send(command: unknown): Promise<unknown> {
    sendCalls.push({ command });
    return sendBehavior(command);
  }
}
