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
import { getInfoJsonObjectFromS3 } from "../../app/util/s3.server.ts";
import {
  ensureInfoJsonSeededAtStartup,
  INFO_CACHE_PATH,
} from "../../server/info.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
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

Deno.test("regenerateInfoCache does not let a delayed stale refresh overwrite a newer listing", async () => {
  setupStorageEnv();
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

  let listCount = 0;
  let infoPutCount = 0;
  let releaseFirstInfoPut = () => {};
  let resolveFirstInfoPutStarted = () => {};
  let resolveSecondInfoPutStarted = () => {};
  const firstInfoPutStarted = new Promise<void>((resolve) => {
    resolveFirstInfoPutStarted = resolve;
  });
  const secondInfoPutStarted = new Promise<void>((resolve) => {
    resolveSecondInfoPutStarted = resolve;
  });

  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;

    if (name === "ListObjectsV2Command") {
      listCount++;
      const contents = [{
        Key: "Artist/First/1__First.mp3",
        LastModified: new Date(),
      }];
      if (listCount > 1) {
        contents.push({
          Key: "Artist/Second/1__Second.mp3",
          LastModified: new Date(),
        });
      }
      return Promise.resolve({ Contents: contents, IsTruncated: false });
    }

    if (name === "PutObjectCommand" && key === "info.json") {
      infoPutCount++;
      if (infoPutCount === 1) {
        resolveFirstInfoPutStarted();
        return new Promise((resolve) => {
          releaseFirstInfoPut = () => resolve(defaultS3MockReply(command));
        });
      }
      resolveSecondInfoPutStarted();
    }

    return defaultS3MockReply(command);
  });

  try {
    const { regenerateInfoCache } = await import("../../server/info.ts");
    const firstRefresh = regenerateInfoCache(
      new Request("http://race.example/info?refresh=1"),
    );
    await firstInfoPutStarted;

    const secondRefresh = regenerateInfoCache(
      new Request("http://race.example/info?refresh=1"),
    );
    await Promise.race([
      secondInfoPutStarted,
      new Promise((resolve) => setTimeout(resolve, 25)),
    ]);

    releaseFirstInfoPut();
    await Promise.all([firstRefresh, secondRefresh]);

    const stored = await getInfoJsonObjectFromS3();
    const body = JSON.parse(stored?.bodyText ?? "{}") as {
      contents?: Record<string, Record<string, unknown>>;
    };
    assertEquals(Boolean(body.contents?.Artist?.Second), true);
  } finally {
    setSendBehavior(null);
  }
});
