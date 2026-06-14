/** @file Tests for S3-backed `info.json` seeding and persistence (mocked SDK). */
import { assertEquals } from "@std/assert";
import { mockFilesWithAlbum, setupStorageEnv } from "./handlers/test-utils.ts";
import {
  clearSendCalls,
  resetMockInfoJsonObject,
  sendCalls,
} from "./s3.server.test-mocks/s3-client.ts";
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

Deno.test("ensureInfoJsonSeededAtStartup rebuilds info.json from listing when S3 object is absent", async () => {
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

  await ensureInfoJsonSeededAtStartup();

  const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
  assertEquals(putCount >= 1, true);
  const disk = await Deno.readTextFile(INFO_CACHE_PATH);
  assertEquals(disk.includes("Test Artist"), true);
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
