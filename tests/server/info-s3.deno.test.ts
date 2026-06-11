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
  INFO_ETAG_CACHE_PATH,
  writeInfoCache,
} from "../../server/info.ts";
import { INFO_DOCUMENT_SCHEMA_VERSION } from "../../server/info-document.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
}

function isListObjects(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  return name === "ListObjectsV2Command";
}

function putInfoJsonBodyText(command: unknown): string | null {
  if (!isPutInfoJson(command)) return null;
  const body = (command as { input?: { Body?: Uint8Array | string } }).input
    ?.Body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return null;
}

async function removeInfoCacheFiles(): Promise<void> {
  try {
    await Deno.remove(INFO_CACHE_PATH);
  } catch {
    // ok
  }
  try {
    await Deno.remove(INFO_ETAG_CACHE_PATH);
  } catch {
    // ok
  }
}

Deno.test("ensureInfoJsonSeededAtStartup regenerates info.json when S3 object is absent", async () => {
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

Deno.test("ensureInfoJsonSeededAtStartup rebuilds from listing instead of stale disk cache", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();
  resetMockInfoJsonObject();
  clearSendCalls();

  await removeInfoCacheFiles();
  await writeInfoCache({
    contents: {},
    timestamp: 1,
    hostname: "stale.example",
    schemaVersion: INFO_DOCUMENT_SCHEMA_VERSION,
  });

  await ensureInfoJsonSeededAtStartup();

  const listCount = sendCalls.filter((c) => isListObjects(c.command)).length;
  const putBody = sendCalls
    .map((c) => putInfoJsonBodyText(c.command))
    .findLast((body) => body !== null);
  const parsed = JSON.parse(putBody ?? "{}") as {
    contents?: Record<string, unknown>;
  };

  assertEquals(listCount >= 1, true);
  assertEquals(parsed.contents?.["Test Artist"] !== undefined, true);
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
