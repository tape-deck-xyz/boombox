/** @file Tests for info endpoint handler */
import { assertEquals } from "@std/assert";
import { handleInfo } from "../../../server/handlers/info.ts";
import { setSendBehavior } from "../s3.server.test-mocks/s3-client.ts";

function setupStorageEnv(): void {
  Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
  Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
  Deno.env.set("STORAGE_REGION", "test-region");
  Deno.env.set("STORAGE_BUCKET", "test-bucket");
}

function mockFilesWithAlbum(): void {
  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "ListObjectsV2Command") {
      return Promise.resolve({
        Contents: [
          {
            Key: "Test%20Artist/Test%20Album/1__Test%20Track.mp3",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }
    return Promise.resolve({});
  });
}

Deno.test("Info handler returns JSON with contents, timestamp, hostname", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  const req = new Request("http://example.com:8000/info?refresh=1", {
    method: "GET",
  });
  const response = await handleInfo(req, {});

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "application/json");

  const body = await response.json();
  assertEquals(typeof body.contents, "object");
  assertEquals(typeof body.timestamp, "number");
  assertEquals(body.hostname, "example.com");
});

Deno.test("Info handler uses cache when no refresh param", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  // First request populates cache
  const req1 = new Request("http://cache-test.example/info?refresh=1", {
    method: "GET",
  });
  const response1 = await handleInfo(req1, {});
  assertEquals(response1.status, 200);
  const body1 = await response1.json();
  const timestamp1 = body1.timestamp;

  // Second request without refresh should serve from cache (same timestamp)
  const req2 = new Request("http://cache-test.example/info", {
    method: "GET",
  });
  const response2 = await handleInfo(req2, {});
  assertEquals(response2.status, 200);
  const body2 = await response2.json();
  assertEquals(body2.timestamp, timestamp1);
});

Deno.test("Info handler regenerates when cache file missing", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  // Remove cache if it exists
  try {
    await Deno.remove("cache/info.json");
  } catch {
    // Ignore if file doesn't exist
  }

  const req = new Request("http://localhost/info", {
    method: "GET",
  });
  const response = await handleInfo(req, {});

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(typeof body.contents, "object");
  assertEquals(typeof body.timestamp, "number");
  assertEquals(body.hostname, "localhost");
});

Deno.test("Info handler regenerates when cache has invalid shape", async () => {
  setupStorageEnv();
  mockFilesWithAlbum();

  // Write invalid cache (missing required fields)
  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(
    "cache/info.json",
    JSON.stringify({ contents: {}, hostname: "x" }),
  );

  const req = new Request("http://localhost/info", {
    method: "GET",
  });
  const response = await handleInfo(req, {});

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(typeof body.timestamp, "number");
  assertEquals(body.hostname, "localhost");
});
