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

function defaultSendBehavior(command: unknown): Promise<unknown> {
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

let sendBehavior: (command: unknown) => Promise<unknown> = defaultSendBehavior;

export function setSendBehavior(
  fn: ((command: unknown) => Promise<unknown>) | null,
): void {
  sendBehavior = fn ?? defaultSendBehavior;
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
