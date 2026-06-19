/** @file Tests for S3-backed `info.json` seeding and persistence (mocked SDK). */
import { assertEquals } from "@std/assert";
import { mockFilesWithAlbum, setupStorageEnv } from "./handlers/test-utils.ts";
import {
  clearSendCalls,
  defaultS3MockReply,
  resetMockInfoJsonObject,
  sendCalls,
  setSendBehavior,
} from "./s3.server.test-mocks/s3-client.ts";
import {
  ensureInfoJsonSeededAtStartup,
  INFO_CACHE_PATH,
  regenerateInfoCache,
} from "../../server/info.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
}

function putInfoJsonBody(command: unknown): string {
  const body = (command as { input?: { Body?: Uint8Array | string } }).input
    ?.Body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return "";
}

Deno.test("ensureInfoJsonSeededAtStartup rebuilds from listing when S3 object is absent", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
  clearSendCalls();

  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(
    INFO_CACHE_PATH,
    JSON.stringify({
      contents: {},
      timestamp: 1,
      hostname: "stale.example",
      schemaVersion: 1,
    }),
  );
  try {
    await Deno.remove("cache/info-s3.etag");
  } catch {
    // ok
  }

  await ensureInfoJsonSeededAtStartup();

  const putBodies = sendCalls
    .filter((c) => isPutInfoJson(c.command))
    .map((c) => putInfoJsonBody(c.command));
  assertEquals(putBodies.length >= 1, true);

  const seeded = JSON.parse(putBodies.at(-1) ?? "{}") as {
    contents?: Record<string, unknown>;
  };
  assertEquals(Object.keys(seeded.contents ?? {}), ["Test Artist"]);
});

Deno.test("regenerateInfoCache serializes overlapping rebuilds so stale listings do not win", async () => {
  setupStorageEnv();
  resetMockInfoJsonObject();
  clearSendCalls();

  let listCount = 0;
  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "ListObjectsV2Command") {
      listCount++;
      if (listCount === 1) {
        return new Promise((resolve) =>
          setTimeout(() =>
            resolve({
              Contents: [
                {
                  Key: "Old%20Artist/Old%20Album/1__Old%20Track.mp3",
                  LastModified: new Date(),
                },
              ],
              IsTruncated: false,
            }), 25)
        );
      }
      return Promise.resolve({
        Contents: [
          {
            Key: "Old%20Artist/Old%20Album/1__Old%20Track.mp3",
            LastModified: new Date(),
          },
          {
            Key: "New%20Artist/New%20Album/1__New%20Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }
    return defaultS3MockReply(command);
  });

  try {
    await Promise.all([
      regenerateInfoCache(new Request("http://race.example/info?refresh=1")),
      regenerateInfoCache(new Request("http://race.example/info?refresh=1")),
    ]);
  } finally {
    setSendBehavior(null);
  }

  const putBodies = sendCalls
    .filter((c) => isPutInfoJson(c.command))
    .map((c) => putInfoJsonBody(c.command));
  const finalBody = JSON.parse(putBodies.at(-1) ?? "{}") as {
    contents?: Record<string, unknown>;
  };
  assertEquals(Object.keys(finalBody.contents ?? {}).sort(), [
    "New Artist",
    "Old Artist",
  ]);
});

Deno.test("ensureInfoJsonSeededAtStartup does not PUT stale disk cache when HEAD fails", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
  clearSendCalls();

  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(
    INFO_CACHE_PATH,
    JSON.stringify({
      contents: {},
      timestamp: 1,
      hostname: "stale.example",
      schemaVersion: 1,
    }),
  );

  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (name === "HeadObjectCommand" && key === "info.json") {
      const err = new Error("throttled");
      (err as { name: string }).name = "Throttling";
      return Promise.reject(err);
    }
    return defaultS3MockReply(command);
  });

  try {
    await ensureInfoJsonSeededAtStartup();
  } finally {
    setSendBehavior(null);
  }

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount, 0);
});

Deno.test("ensureInfoJsonSeededAtStartup does not PUT when mock S3 already has info.json", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  clearSendCalls();

  await regenerateInfoCache(new Request("http://warm.example/"));

  clearSendCalls();
  await ensureInfoJsonSeededAtStartup();

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount, 0);
});
