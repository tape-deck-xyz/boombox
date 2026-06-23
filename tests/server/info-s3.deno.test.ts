/** @file Tests for S3-backed `info.json` seeding and persistence (mocked SDK). */
import { assertEquals, assertStringIncludes } from "@std/assert";
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

  const disk = await Deno.readTextFile(INFO_CACHE_PATH);
  assertStringIncludes(disk, "Test%20Artist");
  assertEquals(disk.includes("stale.example"), false);

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount, 1);
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

Deno.test("regenerateInfoCache retries from a fresh listing after S3 write conflict", async () => {
  setupStorageEnv();
  clearSendCalls();

  let headCount = 0;
  let listCount = 0;
  let putCount = 0;
  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;

    if (name === "HeadObjectCommand" && key === "info.json") {
      headCount++;
      return Promise.resolve({
        ETag: headCount === 1 ? '"base-etag"' : '"winner-etag"',
        LastModified: new Date(),
      });
    }

    if (name === "ListObjectsV2Command") {
      listCount++;
      return Promise.resolve({
        Contents: [
          {
            Key: listCount === 1
              ? "Old%20Artist/Old%20Album/1__Old%20Track.mp3"
              : "Fresh%20Artist/Fresh%20Album/1__Fresh%20Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }

    if (name === "PutObjectCommand" && key === "info.json") {
      putCount++;
      if (putCount === 1) {
        const error = new Error("precondition failed") as Error & {
          name: string;
          $metadata: { httpStatusCode: number };
        };
        error.name = "PreconditionFailed";
        error.$metadata = {
          httpStatusCode: 412,
        };
        return Promise.reject(error);
      }
      return Promise.resolve({ ETag: '"fresh-etag"' });
    }

    return defaultS3MockReply(command);
  });

  try {
    const payload = await regenerateInfoCache(
      new Request("http://retry.example/"),
    );

    assertEquals(putCount, 2);
    assertEquals(
      JSON.stringify(payload.contents).includes("Old%20Artist"),
      false,
    );
    assertStringIncludes(JSON.stringify(payload.contents), "Fresh%20Artist");
  } finally {
    setSendBehavior(null);
  }
});

Deno.test("regenerateInfoCache returns canonical S3 catalog after repeated write conflicts", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
  clearSendCalls();

  await regenerateInfoCache(new Request("http://canonical.example/"));
  clearSendCalls();

  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;

    if (name === "HeadObjectCommand" && key === "info.json") {
      return Promise.resolve({
        ETag: '"stale-etag"',
        LastModified: new Date(),
      });
    }

    if (name === "ListObjectsV2Command") {
      return Promise.resolve({
        Contents: [
          {
            Key: "Old%20Artist/Old%20Album/1__Old%20Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }

    return defaultS3MockReply(command);
  });

  try {
    const payload = await regenerateInfoCache(
      new Request("http://canonical.example/"),
    );

    const body = JSON.stringify(payload.contents);
    assertEquals(body.includes("Old%20Artist"), false);
    assertStringIncludes(body, "Test%20Artist");

    const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
    assertEquals(putCount, 3);
  } finally {
    setSendBehavior(null);
  }
});

Deno.test("regenerateInfoCache skips S3 persist when write precondition HEAD fails", async () => {
  setupStorageEnv();
  clearSendCalls();

  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;

    if (name === "HeadObjectCommand" && key === "info.json") {
      return Promise.reject(new Error("HEAD unavailable"));
    }

    if (name === "ListObjectsV2Command") {
      return Promise.resolve({
        Contents: [
          {
            Key: "Safe%20Artist/Safe%20Album/1__Safe%20Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }

    return defaultS3MockReply(command);
  });

  try {
    const payload = await regenerateInfoCache(
      new Request("http://head-fail.example/"),
    );

    assertStringIncludes(JSON.stringify(payload.contents), "Safe%20Artist");

    const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
    assertEquals(putCount, 0);
  } finally {
    setSendBehavior(null);
  }
});

Deno.test("regenerateInfoCache preserves canonical S3 catalog when missing-object write loses race", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
  clearSendCalls();

  await regenerateInfoCache(new Request("http://race.example/"));
  clearSendCalls();

  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;

    if (name === "HeadObjectCommand" && key === "info.json") {
      const error = new Error("NotFound") as Error & { name: string };
      error.name = "NotFound";
      return Promise.reject(error);
    }

    if (name === "ListObjectsV2Command") {
      return Promise.resolve({
        Contents: [
          {
            Key: "Older%20Artist/Older%20Album/1__Older%20Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }

    return defaultS3MockReply(command);
  });

  try {
    const payload = await regenerateInfoCache(
      new Request("http://race.example/"),
    );

    const body = JSON.stringify(payload.contents);
    assertEquals(body.includes("Older%20Artist"), false);
    assertStringIncludes(body, "Test%20Artist");
  } finally {
    setSendBehavior(null);
  }
});
