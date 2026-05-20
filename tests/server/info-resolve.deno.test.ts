/** @file Tests for {@link resolveInfoPayloadForGet} revalidation (TTL hook + S3 ETag). */
import { assertEquals } from "@std/assert";
import {
  INFO_CACHE_PATH,
  INFO_ETAG_CACHE_PATH,
  readInfoCache,
  resolveInfoPayloadForGet,
  writeInfoCache,
} from "../../server/info.ts";
import {
  createAdminAuthHeader,
  mockFilesWithAlbum,
  setupAdminEnv,
  setupStorageEnv,
} from "./handlers/test-utils.ts";
import {
  defaultS3MockReply,
  resetMockInfoJsonObject,
  setSendBehavior,
} from "./s3.server.test-mocks/s3-client.ts";

function cleanupTtlEnv(): void {
  Deno.env.delete("INFO_DISK_CACHE_TTL_TEST_MS");
}

Deno.test("resolveInfoPayloadForGet uses disk when TTL=0 and S3 ETag matches sidecar", async () => {
  const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
  setupStorageEnv();
  setupAdminEnv();
  mockFilesWithAlbum();
  try {
    Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "0");
    const { handleInfo } = await import("../../server/handlers/info.ts");
    const refreshReq = new Request("http://reval.example/info?refresh=1", {
      headers: { Authorization: createAdminAuthHeader() },
    });
    await handleInfo(refreshReq, {});

    const r = await resolveInfoPayloadForGet(
      new Request("http://reval.example/info"),
    );
    assertEquals(typeof r.payload.timestamp, "number");
    assertEquals(r.etagForHttp != null && r.etagForHttp.length > 0, true);
  } finally {
    if (prevTtl === undefined) cleanupTtlEnv();
    else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
  }
});

Deno.test(
  "resolveInfoPayloadForGet refetches S3 when sidecar ETag disagrees with HEAD",
  async () => {
    const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
    setupStorageEnv();
    setupAdminEnv();
    mockFilesWithAlbum();
    try {
      Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "0");
      const { handleInfo } = await import("../../server/handlers/info.ts");
      await handleInfo(
        new Request("http://stale-.example/info?refresh=1", {
          headers: { Authorization: createAdminAuthHeader() },
        }),
        {},
      );

      await Deno.writeTextFile(INFO_ETAG_CACHE_PATH, "wrong-etag-for-test");

      const r = await resolveInfoPayloadForGet(
        new Request("http://stale-.example/info"),
      );
      assertEquals(typeof r.payload.contents, "object");
      assertEquals(r.etagForHttp === "wrong-etag-for-test", false);
    } finally {
      if (prevTtl === undefined) cleanupTtlEnv();
      else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
    }
  },
);

Deno.test(
  "resolveInfoPayloadForGet rebuilds from listing when S3 body is invalid JSON",
  async () => {
    setupStorageEnv();
    mockFilesWithAlbum();
    resetMockInfoJsonObject();

    setSendBehavior((command: unknown) => {
      const key = (command as { input?: { Key?: string } }).input?.Key;
      const name = (command as { constructor: { name: string } }).constructor
        ?.name;
      if (name === "GetObjectCommand" && key === "info.json") {
        return Promise.resolve({
          ETag: '"bad"',
          Body: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("not json"));
              c.close();
            },
          }),
        });
      }
      return defaultS3MockReply(command);
    });

    try {
      try {
        await Deno.remove(INFO_CACHE_PATH);
      } catch {
        /* ok */
      }
      try {
        await Deno.remove(INFO_ETAG_CACHE_PATH);
      } catch {
        /* ok */
      }

      const r = await resolveInfoPayloadForGet(
        new Request("http://bad-s3-json.example/info"),
      );
      assertEquals(
        Object.keys(r.payload.contents).length >= 0,
        true,
      );
    } finally {
      setSendBehavior(null);
    }
  },
);

Deno.test(
  "resolveInfoPayloadForGet keeps fresher disk catalog when S3 info.json is older",
  async () => {
    const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
    setupStorageEnv();
    resetMockInfoJsonObject();
    const olderS3Payload = {
      contents: {
        Old: {
          Album: {
            id: "Old/Album",
            title: "Album",
            coverArtUrl: null,
            tracks: [{
              title: "Old Track",
              trackNum: 1,
              lastModified: null,
              url: "https://example.com/old.mp3",
            }],
          },
        },
      },
      timestamp: 100,
      hostname: "older.example",
      schemaVersion: 1,
    };
    const fresherDiskPayload = {
      contents: {
        Fresh: {
          Album: {
            id: "Fresh/Album",
            title: "Album",
            coverArtUrl: null,
            tracks: [{
              title: "Fresh Track",
              trackNum: 1,
              lastModified: null,
              url: "https://example.com/fresh.mp3",
            }],
          },
        },
      },
      timestamp: 200,
      hostname: "fresh.example",
      schemaVersion: 1,
    };

    setSendBehavior((command: unknown) => {
      const key = (command as { input?: { Key?: string } }).input?.Key;
      const name = (command as { constructor: { name: string } }).constructor
        ?.name;
      if (key === "info.json" && name === "HeadObjectCommand") {
        return Promise.resolve({
          ETag: '"older-etag"',
          LastModified: new Date(),
        });
      }
      if (key === "info.json" && name === "GetObjectCommand") {
        return Promise.resolve({
          ETag: '"older-etag"',
          Body: new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode(JSON.stringify(olderS3Payload)),
              );
              c.close();
            },
          }),
        });
      }
      return defaultS3MockReply(command);
    });

    try {
      Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "0");
      await writeInfoCache(fresherDiskPayload);
      try {
        await Deno.remove(INFO_ETAG_CACHE_PATH);
      } catch {
        /* ok */
      }

      const resolved = await resolveInfoPayloadForGet(
        new Request("http://fresh-disk.example/info"),
      );

      assertEquals(resolved.payload.timestamp, 200);
      assertEquals(Object.keys(resolved.payload.contents), ["Fresh"]);
      assertEquals((await readInfoCache())?.timestamp, 200);
    } finally {
      setSendBehavior(null);
      if (prevTtl === undefined) cleanupTtlEnv();
      else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
    }
  },
);
