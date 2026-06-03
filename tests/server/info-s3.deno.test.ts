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
  writeInfoCache,
} from "../../server/info.ts";
import { INFO_DOCUMENT_SCHEMA_VERSION } from "../../server/info-document.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
}

function putInfoJsonBody(command: unknown): string {
  const body = (command as { input?: { Body?: string | Uint8Array } }).input
    ?.Body;
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

Deno.test("ensureInfoJsonSeededAtStartup rebuilds from listing when S3 object is absent", async () => {
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
    await Deno.remove(INFO_ETAG_CACHE_PATH);
  } catch {
    // ok
  }

  await writeInfoCache({
    contents: {
      "Stale Artist": {
        "Stale Album": {
          id: "Stale Artist/Stale Album",
          title: "Stale Album",
          coverArtUrl: null,
          tracks: [],
        },
      },
    },
    timestamp: 1,
    hostname: "stale.example",
    schemaVersion: INFO_DOCUMENT_SCHEMA_VERSION,
  });

  clearSendCalls();

  await ensureInfoJsonSeededAtStartup();

  const put = sendCalls.find((c) => isPutInfoJson(c.command));
  const payload = JSON.parse(putInfoJsonBody(put?.command)) as {
    contents?: Record<string, unknown>;
  };
  assertEquals(Object.keys(payload.contents ?? {}), ["Test Artist"]);
});

Deno.test("ensureInfoJsonSeededAtStartup skips seeding when S3 HEAD fails", async () => {
  setupStorageEnv();
  resetMockInfoJsonObject();
  clearSendCalls();

  await writeInfoCache({
    contents: {
      "Stale Artist": {
        "Stale Album": {
          id: "Stale Artist/Stale Album",
          title: "Stale Album",
          coverArtUrl: null,
          tracks: [],
        },
      },
    },
    timestamp: 1,
    hostname: "stale.example",
    schemaVersion: INFO_DOCUMENT_SCHEMA_VERSION,
  });

  setSendBehavior((command) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (name === "HeadObjectCommand" && key === "info.json") {
      const err = new Error("temporary S3 failure");
      (err as { name: string }).name = "InternalError";
      return Promise.reject(err);
    }
    return defaultS3MockReply(command);
  });

  try {
    await ensureInfoJsonSeededAtStartup();

    const putCount = sendCalls.filter((c) => isPutInfoJson(c.command)).length;
    assertEquals(putCount, 0);
  } finally {
    setSendBehavior(null);
  }
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
