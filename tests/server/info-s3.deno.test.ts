/** @file Tests for S3-backed `info.json` seeding and persistence (mocked SDK). */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
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
  readInfoCache,
  regenerateInfoCache,
} from "../../server/info.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

Deno.test("ensureInfoJsonSeededAtStartup PUTs info.json from disk when S3 object is absent", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
  clearSendCalls();

  try {
    await Deno.remove(INFO_CACHE_PATH);
  } catch {
    // ok
  }
  try {
    await Deno.remove("cache/info-s3.etag");
  } catch {
    // ok
  }

  const { regenerateInfoCache } = await import("../../server/info.ts");
  await regenerateInfoCache(new Request("http://seed.example/"));

  resetMockInfoJsonObject();
  clearSendCalls();

  await ensureInfoJsonSeededAtStartup();

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount >= 1, true);
});

Deno.test("ensureInfoJsonSeededAtStartup does not PUT when mock S3 already has info.json", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  clearSendCalls();

  const { regenerateInfoCache } = await import("../../server/info.ts");
  await regenerateInfoCache(new Request("http://warm.example/"));

  clearSendCalls();
  await ensureInfoJsonSeededAtStartup();

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount, 0);
});

Deno.test("regenerateInfoCache rejects when S3 info.json persistence fails", async () => {
  setupStorageEnv();
  clearSendCalls();
  try {
    await Deno.remove(INFO_CACHE_PATH);
  } catch {
    // ok
  }
  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (name === "ListObjectsV2Command") {
      return Promise.resolve({
        Contents: [
          {
            Key: "Published%20Artist/Published%20Album/1__Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }
    if (name === "PutObjectCommand" && key === "info.json") {
      return Promise.reject(new Error("AccessDenied"));
    }
    return defaultS3MockReply(command);
  });

  try {
    await assertRejects(
      () => regenerateInfoCache(new Request("http://publish.example/")),
      Error,
      "AccessDenied",
    );
    assertEquals(await readInfoCache(), null);
  } finally {
    setSendBehavior(null);
  }
});

Deno.test("regenerateInfoCache serializes rebuilds so older listings cannot overwrite newer ones", async () => {
  setupStorageEnv();
  clearSendCalls();
  const firstPut = deferred<{ ETag: string }>();
  let listCallCount = 0;
  let finalInfoJsonBody = "";

  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (name === "ListObjectsV2Command") {
      listCallCount++;
      const contents = [
        {
          Key: "Race%20Artist/Race%20Album/1__Track%20One.mp3",
          LastModified: new Date(),
        },
      ];
      if (listCallCount >= 2) {
        contents.push({
          Key: "Race%20Artist/Race%20Album/2__Track%20Two.mp3",
          LastModified: new Date(),
        });
      }
      return Promise.resolve({ Contents: contents, IsTruncated: false });
    }
    if (name === "PutObjectCommand" && key === "info.json") {
      const body = (command as { input?: { Body?: Uint8Array } }).input?.Body;
      const bodyText = body ? new TextDecoder().decode(body) : "";
      if (!bodyText.includes("Track Two.mp3")) {
        return firstPut.promise.then((result) => {
          finalInfoJsonBody = bodyText;
          return result;
        });
      }
      finalInfoJsonBody = bodyText;
      return Promise.resolve({ ETag: '"fresh-etag"' });
    }
    return defaultS3MockReply(command);
  });

  try {
    const first = regenerateInfoCache(new Request("http://race.example/"));
    await new Promise((r) => setTimeout(r, 0));
    const second = regenerateInfoCache(new Request("http://race.example/"));
    await new Promise((r) => setTimeout(r, 0));

    firstPut.resolve({ ETag: '"stale-etag"' });
    await Promise.all([first, second]);

    assertStringIncludes(finalInfoJsonBody, "Track Two.mp3");
  } finally {
    setSendBehavior(null);
  }
});
