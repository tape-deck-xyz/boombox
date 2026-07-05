/** @file Branch coverage for {@link ../../server/info.ts} error and edge paths. */
import { assertEquals } from "@std/assert";
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
import {
  ensureInfoJsonSeededAtStartup,
  INFO_CACHE_PATH,
  INFO_ETAG_CACHE_PATH,
  readInfoCache,
  regenerateInfoCache,
  resolveInfoPayloadForGet,
} from "../../server/info.ts";
import { getInfoJsonObjectFromS3 } from "../../app/util/s3.server.ts";

Deno.test("regenerateInfoCache still returns payload when S3 PutObject for info.json fails", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  setSendBehavior((command: unknown) => {
    const key = (command as { input?: { Key?: string } }).input?.Key;
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "PutObjectCommand" && key === "info.json") {
      return Promise.reject(new Error("mock S3 put failure"));
    }
    return defaultS3MockReply(command);
  });

  try {
    const { regenerateInfoCache } = await import("../../server/info.ts");
    const payload = await regenerateInfoCache(
      new Request("http://put-fail.example/"),
    );
    assertEquals(typeof payload.timestamp, "number");
    assertEquals(typeof payload.contents, "object");
  } finally {
    setSendBehavior(null);
  }
});

Deno.test("regenerateInfoCache prevents stale concurrent rebuilds from overwriting newer S3 info.json", async () => {
  setupStorageEnv();
  resetMockInfoJsonObject();

  let listCount = 0;
  let putCount = 0;
  let firstPutStarted!: () => void;
  let releaseFirstPut!: () => void;
  let releaseFirstPutIfNeeded = false;
  const firstPutStartedPromise = new Promise<void>((resolve) => {
    firstPutStarted = resolve;
  });
  const firstPutGate = new Promise<void>((resolve) => {
    releaseFirstPut = () => {
      if (!releaseFirstPutIfNeeded) {
        releaseFirstPutIfNeeded = true;
        resolve();
      }
    };
  });

  setSendBehavior((command: unknown) => {
    const key = (command as { input?: { Key?: string } }).input?.Key;
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;

    if (name === "ListObjectsV2Command") {
      listCount++;
      return Promise.resolve({
        Contents: [
          {
            Key: "Race%20Artist/Race%20Album/1__First%20Track.mp3",
            LastModified: new Date(),
          },
          ...(listCount === 1 ? [] : [{
            Key: "Race%20Artist/Race%20Album/2__Second%20Track.mp3",
            LastModified: new Date(),
          }]),
        ],
        IsTruncated: false,
      });
    }

    if (name === "PutObjectCommand" && key === "info.json") {
      putCount++;
      if (putCount === 1) {
        firstPutStarted();
        return firstPutGate.then(() => defaultS3MockReply(command));
      }
      releaseFirstPut();
    }

    return defaultS3MockReply(command);
  });

  try {
    const first = regenerateInfoCache(new Request("http://race.example/"));
    await firstPutStartedPromise;
    const second = regenerateInfoCache(new Request("http://race.example/"));

    await Promise.race([
      second.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 20)),
    ]);
    releaseFirstPut();
    await Promise.all([first, second]);

    const stored = await getInfoJsonObjectFromS3();
    const parsed = JSON.parse(stored?.bodyText ?? "{}") as {
      contents?: {
        "Race Artist"?: {
          "Race Album"?: {
            tracks?: Array<{ title: string }>;
          };
        };
      };
    };
    assertEquals(
      parsed.contents?.["Race Artist"]?.["Race Album"]?.tracks?.map((track) =>
        track.title
      ),
      ["First Track.mp3", "Second Track.mp3"],
    );
  } finally {
    setSendBehavior(null);
  }
});

function cleanupTtlEnv(): void {
  Deno.env.delete("INFO_DISK_CACHE_TTL_TEST_MS");
}

Deno.test(
  "resolveInfoPayloadForGet uses default disk TTL when INFO_DISK_CACHE_TTL_TEST_MS is not an integer",
  async () => {
    const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
    setupStorageEnv();
    setupAdminEnv();
    mockFilesWithAlbum();
    try {
      Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "not-a-number");
      const { handleInfo } = await import("../../server/handlers/info.ts");
      await handleInfo(
        new Request("http://ttl-bad.example/info?refresh=1", {
          headers: { Authorization: createAdminAuthHeader() },
        }),
        {},
      );
      const r = await resolveInfoPayloadForGet(
        new Request("http://ttl-bad.example/info"),
      );
      assertEquals(typeof r.payload.timestamp, "number");
    } finally {
      if (prevTtl === undefined) cleanupTtlEnv();
      else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
    }
  },
);

Deno.test(
  "resolveInfoPayloadForGet keeps disk payload when S3 HEAD throws during revalidation",
  async () => {
    const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
    setupStorageEnv();
    setupAdminEnv();
    mockFilesWithAlbum();
    try {
      Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "0");
      const { handleInfo } = await import("../../server/handlers/info.ts");
      await handleInfo(
        new Request("http://head-throw.example/info?refresh=1", {
          headers: { Authorization: createAdminAuthHeader() },
        }),
        {},
      );

      setSendBehavior((command: unknown) => {
        const key = (command as { input?: { Key?: string } }).input?.Key;
        const name = (command as { constructor: { name: string } }).constructor
          ?.name;
        if (name === "HeadObjectCommand" && key === "info.json") {
          return Promise.reject(new Error("mock HEAD failure"));
        }
        return defaultS3MockReply(command);
      });

      const r = await resolveInfoPayloadForGet(
        new Request("http://head-throw.example/info"),
      );
      assertEquals(typeof r.payload.contents, "object");
    } finally {
      setSendBehavior(null);
      if (prevTtl === undefined) cleanupTtlEnv();
      else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
    }
  },
);

Deno.test(
  "resolveInfoPayloadForGet omits HTTP ETag when sidecar file is only whitespace",
  async () => {
    const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
    setupStorageEnv();
    setupAdminEnv();
    mockFilesWithAlbum();
    try {
      Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "900000");
      const { handleInfo } = await import("../../server/handlers/info.ts");
      await handleInfo(
        new Request("http://etag-ws.example/info?refresh=1", {
          headers: { Authorization: createAdminAuthHeader() },
        }),
        {},
      );
      await Deno.writeTextFile(INFO_ETAG_CACHE_PATH, "  \n\t  ");
      const diskBefore = await Deno.readTextFile(INFO_CACHE_PATH);
      const r = await resolveInfoPayloadForGet(
        new Request("http://etag-ws.example/info"),
      );
      assertEquals(await Deno.readTextFile(INFO_CACHE_PATH), diskBefore);
      assertEquals(r.etagForHttp, undefined);
    } finally {
      if (prevTtl === undefined) cleanupTtlEnv();
      else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
    }
  },
);

Deno.test("readInfoCache defaults schemaVersion to 0 when value is not a number", async () => {
  setupStorageEnv();
  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(
    INFO_CACHE_PATH,
    JSON.stringify({
      contents: {},
      timestamp: 1,
      hostname: "h",
      schemaVersion: "not-a-number",
    }),
  );
  const row = await readInfoCache();
  assertEquals(row?.schemaVersion, 0);
});

Deno.test(
  "resolveInfoPayloadForGet returns disk catalog when ETag sidecar file is absent",
  async () => {
    const prevTtl = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
    setupStorageEnv();
    setupAdminEnv();
    mockFilesWithAlbum();
    try {
      Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", "900000");
      const { handleInfo } = await import("../../server/handlers/info.ts");
      await handleInfo(
        new Request("http://no-etag.example/info?refresh=1", {
          headers: { Authorization: createAdminAuthHeader() },
        }),
        {},
      );
      try {
        await Deno.remove(INFO_ETAG_CACHE_PATH);
      } catch {
        /* ok */
      }
      const bodyBefore = await Deno.readTextFile(INFO_CACHE_PATH);
      const r = await resolveInfoPayloadForGet(
        new Request("http://no-etag.example/info"),
      );
      assertEquals(await Deno.readTextFile(INFO_CACHE_PATH), bodyBefore);
      assertEquals(r.etagForHttp, undefined);
    } finally {
      if (prevTtl === undefined) cleanupTtlEnv();
      else Deno.env.set("INFO_DISK_CACHE_TTL_TEST_MS", prevTtl);
    }
  },
);

Deno.test(
  "ensureInfoJsonSeededAtStartup continues when catalog rebuild throws",
  async () => {
    setupStorageEnv();
    mockFilesWithAlbum();
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
    resetMockInfoJsonObject();

    setSendBehavior((command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        ?.name;
      if (name === "ListObjectsV2Command") {
        return Promise.reject(new Error("mock listing unavailable"));
      }
      return defaultS3MockReply(command);
    });

    try {
      await ensureInfoJsonSeededAtStartup();
    } finally {
      setSendBehavior(null);
    }
  },
);

Deno.test("resolveInfoPayloadForGet upgrades schemaVersion 0 from S3 info.json", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  const validBody = {
    contents: {},
    timestamp: 42,
    hostname: "",
    schemaVersion: 0,
  };

  setSendBehavior((command: unknown) => {
    const key = (command as { input?: { Key?: string } }).input?.Key;
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "GetObjectCommand" && key === "info.json") {
      return Promise.resolve({
        ETag: '"v0"',
        Body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(JSON.stringify(validBody)));
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
      new Request("http://schema0.example/info"),
    );
    assertEquals(r.payload.schemaVersion >= 1, true);
    assertEquals(r.payload.timestamp, 42);
  } finally {
    setSendBehavior(null);
  }
});

Deno.test(
  "ensureInfoJsonSeededAtStartup continues when uploading info.json from disk cache fails",
  async () => {
    setupStorageEnv();
    mockFilesWithAlbum();
    resetMockInfoJsonObject();
    const { regenerateInfoCache } = await import("../../server/info.ts");
    await regenerateInfoCache(new Request("http://seed-upfail.example/"));
    resetMockInfoJsonObject();

    setSendBehavior((command: unknown) => {
      const key = (command as { input?: { Key?: string } }).input?.Key;
      const name = (command as { constructor: { name: string } }).constructor
        ?.name;
      if (name === "PutObjectCommand" && key === "info.json") {
        return Promise.reject(new Error("startup put blocked"));
      }
      return defaultS3MockReply(command);
    });

    try {
      await ensureInfoJsonSeededAtStartup();
    } finally {
      setSendBehavior(null);
    }

    const disk = await Deno.readTextFile(INFO_CACHE_PATH);
    assertEquals(disk.includes('"contents"'), true);
  },
);
