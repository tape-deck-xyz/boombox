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
  regenerateInfoCache,
  writeInfoCache,
} from "../../server/info.ts";
import { getInfoJsonObjectFromS3 } from "../../app/util/s3.server.ts";

function isPutInfoJson(command: unknown): boolean {
  const name = (command as { constructor: { name: string } }).constructor?.name;
  if (name !== "PutObjectCommand") return false;
  const key = (command as { input?: { Key?: string } }).input?.Key;
  return key === "info.json";
}

function infoJsonPutBodies(): string[] {
  return sendCalls.filter((c) => isPutInfoJson(c.command)).map((c) => {
    const body = (c.command as { input?: { Body?: Uint8Array | string } }).input
      ?.Body;
    return typeof body === "string"
      ? body
      : body
      ? new TextDecoder().decode(body)
      : "";
  });
}

Deno.test("ensureInfoJsonSeededAtStartup PUTs rebuilt info.json when S3 object is absent", async () => {
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

Deno.test("ensureInfoJsonSeededAtStartup does not PUT stale disk cache when S3 HEAD fails", async () => {
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
    contents: {},
    timestamp: 1,
    hostname: "stale.example",
    schemaVersion: 1,
  });

  setSendBehavior((command) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (name === "HeadObjectCommand" && key === "info.json") {
      const err = new Error("AccessDenied");
      (err as { name: string }).name = "AccessDenied";
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

Deno.test("ensureInfoJsonSeededAtStartup rebuilds missing S3 info.json from listing instead of disk cache", async () => {
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
    contents: {},
    timestamp: 1,
    hostname: "stale.example",
    schemaVersion: 1,
  });

  await ensureInfoJsonSeededAtStartup();

  const bodies = infoJsonPutBodies();
  assertEquals(bodies.length >= 1, true);
  const payload = JSON.parse(bodies.at(-1)!) as {
    contents: Record<string, unknown>;
  };
  assertEquals(Object.keys(payload.contents), ["Test Artist"]);
});

Deno.test("regenerateInfoCache does not let an older rebuild overwrite a newer catalog", async () => {
  setupStorageEnv();
  resetMockInfoJsonObject();
  clearSendCalls();

  let listCallCount = 0;
  let releaseFirstPut: (() => void) | undefined;
  let firstPutStarted: (() => void) | undefined;
  let secondPutCompleted: (() => void) | undefined;
  const firstPutStartedPromise = new Promise<void>((resolve) => {
    firstPutStarted = resolve;
  });
  const secondPutCompletedPromise = new Promise<void>((resolve) => {
    secondPutCompleted = resolve;
  });
  const wait = (ms: number) =>
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms));

  setSendBehavior((command) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    const key = (command as { input?: { Key?: string } }).input?.Key;
    if (name === "ListObjectsV2Command") {
      listCallCount++;
      const contents = [
        { Key: "Artist/Album/1__First.mp3", LastModified: new Date() },
      ];
      if (listCallCount > 1) {
        contents.push({
          Key: "Artist/Album/2__Second.mp3",
          LastModified: new Date(),
        });
      }
      return Promise.resolve({ Contents: contents, IsTruncated: false });
    }
    if (name === "PutObjectCommand" && key === "info.json") {
      const body = (command as { input?: { Body?: Uint8Array | string } }).input
        ?.Body;
      const text = typeof body === "string"
        ? body
        : body
        ? new TextDecoder().decode(body)
        : "";
      if (!text.includes("Second.mp3")) {
        firstPutStarted?.();
        return new Promise((resolve, reject) => {
          releaseFirstPut = () => {
            defaultS3MockReply(command).then(resolve, reject);
          };
        });
      }
      return defaultS3MockReply(command).then((result) => {
        secondPutCompleted?.();
        return result;
      });
    }
    return defaultS3MockReply(command);
  });

  try {
    const first = regenerateInfoCache(new Request("http://race.example/one"));
    await firstPutStartedPromise;
    const second = regenerateInfoCache(new Request("http://race.example/two"));
    const secondFinishedBeforeFirstRelease = await Promise.race([
      secondPutCompletedPromise.then(() => true),
      wait(10),
    ]);
    releaseFirstPut?.();
    await Promise.all([first, second]);

    const got = await getInfoJsonObjectFromS3();
    const finalPayload = JSON.parse(got!.bodyText) as {
      contents: { Artist?: { Album?: { tracks?: Array<{ title: string }> } } };
    };
    const titles = finalPayload.contents.Artist?.Album?.tracks?.map((track) =>
      track.title
    );
    assertEquals(secondFinishedBeforeFirstRelease, false);
    assertEquals(titles, ["First.mp3", "Second.mp3"]);
  } finally {
    setSendBehavior(null);
  }
});
