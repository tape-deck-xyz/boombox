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

/** In-memory `info.json` for tests (Persists until cleared). */
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

/** Default mock reply for non-test-specific commands. Exported for composable handlers. */
export function defaultS3MockReply(command: unknown): Promise<unknown> {
  const info = mockInfoJsonCommand(command);
  if (info !== null) return info;

  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name === "HeadObjectCommand") {
    const err = new Error("NotFound");
    (err as { name: string }).name = "NotFound";
    return Promise.reject(err);
  }
  if (name === "ListObjectsV2Command" && Deno.env.get("E2E_MODE") === "1") {
    if (Deno.env.get("E2E_EMPTY") === "1") {
      return Promise.resolve({ Contents: [], IsTruncated: false });
    }
    return Promise.resolve({
      Contents: E2E_FIXTURE_KEYS,
      IsTruncated: false,
    });
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
