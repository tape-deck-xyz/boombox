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
  readInfoCache,
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

Deno.test("concurrent info regenerations do not let an older listing overwrite a newer catalog", async () => {
  setupStorageEnv();
  resetMockInfoJsonObject();
  clearSendCalls();
  try {
    await Deno.remove(INFO_CACHE_PATH);
  } catch {
    // ok
  }

  let listCalls = 0;
  const staleContents = [
    { Key: "Alpha/First/1__Opening.mp3", LastModified: new Date(1) },
  ];
  const freshContents = [
    ...staleContents,
    { Key: "Beta/Second/1__Finale.mp3", LastModified: new Date(2) },
  ];

  setSendBehavior(async (command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "ListObjectsV2Command") {
      listCalls++;
      if (listCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { Contents: staleContents, IsTruncated: false };
      }
      return { Contents: freshContents, IsTruncated: false };
    }
    return defaultS3MockReply(command);
  });

  try {
    const { regenerateInfoCache } = await import("../../server/info.ts");
    await Promise.all([
      regenerateInfoCache(new Request("http://race.example/first")),
      regenerateInfoCache(new Request("http://race.example/second")),
    ]);

    const cache = await readInfoCache();
    assertEquals(cache?.contents.Beta?.Second?.tracks.length, 1);
  } finally {
    setSendBehavior(null);
  }
});
