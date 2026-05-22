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
  INFO_ETAG_CACHE_PATH,
  readInfoCache,
} from "../../server/info.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
}

Deno.test("ensureInfoJsonSeededAtStartup seeds info.json when S3 object is absent", async () => {
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

Deno.test("ensureInfoJsonSeededAtStartup does not PUT disk cache when S3 HEAD fails", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  const { regenerateInfoCache } = await import("../../server/info.ts");
  await regenerateInfoCache(new Request("http://head-fail.example/"));

  setSendBehavior((command: unknown) => {
    const key = (command as { input?: { Key?: string } }).input?.Key;
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "HeadObjectCommand" && key === "info.json") {
      return Promise.reject(new Error("transient S3 HEAD failure"));
    }
    return defaultS3MockReply(command);
  });
  clearSendCalls();

  try {
    await ensureInfoJsonSeededAtStartup();
  } finally {
    setSendBehavior(null);
  }

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount, 0);
});

Deno.test("ensureInfoJsonSeededAtStartup rebuilds from listing when S3 info.json is absent", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
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
    await Deno.remove(INFO_ETAG_CACHE_PATH);
  } catch {
    // ok
  }

  await ensureInfoJsonSeededAtStartup();

  const disk = await readInfoCache();
  assertEquals(
    disk?.contents["Test Artist"]?.["Test Album"]?.tracks.length,
    1,
  );
});
