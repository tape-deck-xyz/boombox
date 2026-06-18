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
  regenerateInfoCache,
  writeInfoCache,
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

  await writeInfoCache({
    contents: {
      "Stale Artist": {
        "Stale Album": {
          id: "Stale Artist/Stale Album",
          title: "Stale Album",
          coverArtUrl: null,
          tracks: [{
            title: "Missing Track",
            trackNum: 1,
            lastModified: null,
            url: "Stale%20Artist/Stale%20Album/1__Missing%20Track.mp3",
          }],
        },
      },
    },
    timestamp: 1,
    hostname: "stale.example",
    schemaVersion: 1,
  });

  resetMockInfoJsonObject();
  clearSendCalls();

  await ensureInfoJsonSeededAtStartup();

  const putInfoCalls = sendCalls.filter((c) => isPutInfoJson(c.command));
  assertEquals(putInfoCalls.length >= 1, true);
  const body = (putInfoCalls.at(-1)!.command as {
    input?: { Body?: Uint8Array | string };
  }).input?.Body;
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  const payload = JSON.parse(text);
  assertEquals(payload.contents["Test Artist"] != null, true);
  assertEquals(payload.contents["Stale Artist"], undefined);
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
