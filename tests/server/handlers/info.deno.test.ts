/** @file Tests for info endpoint handler */
import { assertEquals } from "@std/assert";
import { handleInfo } from "../../../server/handlers/info.ts";
import {
  createAdminAuthHeader,
  mockFilesWithAlbum,
  setupAdminEnv,
  setupStorageEnv,
} from "./test-utils.ts";

Deno.test("Info handler returns 401 when refresh=1 without auth", async () => {
  setupStorageEnv();
  setupAdminEnv();
  mockFilesWithAlbum();

  const req = new Request("http://example.com:8000/info?refresh=1", {
    method: "GET",
  });
  const response = await handleInfo(req, {});

  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("WWW-Authenticate"),
    'Basic realm="Admin", charset="UTF-8"',
  );
});

Deno.test("Info handler returns JSON with contents, timestamp, hostname when refresh=1 with auth", async () => {
  setupStorageEnv();
  setupAdminEnv();
  mockFilesWithAlbum();

  const req = new Request("http://example.com:8000/info?refresh=1", {
    method: "GET",
    headers: { Authorization: createAdminAuthHeader() },
  });
  const response = await handleInfo(req, {});

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );

  const body = await response.json();
  assertEquals(typeof body.contents, "object");
  assertEquals(typeof body.timestamp, "number");
  assertEquals(body.hostname, "example.com");
  assertEquals(typeof body.schemaVersion, "number");
});

Deno.test("Info handler uses cache when no refresh param", async () => {
  setupStorageEnv();
  setupAdminEnv();
  mockFilesWithAlbum();

  // First request populates cache (requires auth for refresh)
  const req1 = new Request("http://cache-test.example/info?refresh=1", {
    method: "GET",
    headers: { Authorization: createAdminAuthHeader() },
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

Deno.test("Info handler returns 401 when ALLOW_PUBLIC_INFO_JSON=false and not admin", async () => {
  const prev = Deno.env.get("ALLOW_PUBLIC_INFO_JSON");
  try {
    Deno.env.set("ALLOW_PUBLIC_INFO_JSON", "false");
    setupStorageEnv();
    setupAdminEnv();
    mockFilesWithAlbum();

    const req = new Request("http://example.com/info", { method: "GET" });
    const response = await handleInfo(req, {});

    assertEquals(response.status, 401);
  } finally {
    if (prev === undefined) Deno.env.delete("ALLOW_PUBLIC_INFO_JSON");
    else Deno.env.set("ALLOW_PUBLIC_INFO_JSON", prev);
  }
});

Deno.test(
  "Info handler returns 200 when ALLOW_PUBLIC_INFO_JSON=false and admin Authorization is valid",
  async () => {
    const prev = Deno.env.get("ALLOW_PUBLIC_INFO_JSON");
    try {
      Deno.env.set("ALLOW_PUBLIC_INFO_JSON", "false");
      setupStorageEnv();
      setupAdminEnv();
      mockFilesWithAlbum();

      const req = new Request("http://example.com/info?refresh=1", {
        method: "GET",
        headers: { Authorization: createAdminAuthHeader() },
      });
      const responseRefresh = await handleInfo(req, {});
      assertEquals(responseRefresh.status, 200);

      const req2 = new Request("http://example.com/info", {
        method: "GET",
        headers: { Authorization: createAdminAuthHeader() },
      });
      const response2 = await handleInfo(req2, {});
      assertEquals(response2.status, 200);
      const body = await response2.json();
      assertEquals(typeof body.contents, "object");
      assertEquals(body.hostname, "example.com");
    } finally {
      if (prev === undefined) Deno.env.delete("ALLOW_PUBLIC_INFO_JSON");
      else Deno.env.set("ALLOW_PUBLIC_INFO_JSON", prev);
    }
  },
);

Deno.test("Info handler sets ETag and public Cache-Control when catalog is public", async () => {
  const prev = Deno.env.get("ALLOW_PUBLIC_INFO_JSON");
  try {
    Deno.env.delete("ALLOW_PUBLIC_INFO_JSON");
    setupStorageEnv();
    mockFilesWithAlbum();

    const req = new Request("http://localhost/info?refresh=1", {
      method: "GET",
      headers: { Authorization: createAdminAuthHeader() },
    });
    await handleInfo(req, {});

    const req2 = new Request("http://localhost/info", { method: "GET" });
    const response = await handleInfo(req2, {});
    assertEquals(response.status, 200);
    assertEquals(
      (response.headers.get("Cache-Control") ?? "").includes("public"),
      true,
    );
    assertEquals(response.headers.get("ETag") != null, true);
  } finally {
    if (prev === undefined) Deno.env.delete("ALLOW_PUBLIC_INFO_JSON");
    else Deno.env.set("ALLOW_PUBLIC_INFO_JSON", prev);
  }
});

Deno.test(
  "Info handler sets private Cache-Control when ALLOW_PUBLIC_INFO_JSON=false and admin",
  async () => {
    const prev = Deno.env.get("ALLOW_PUBLIC_INFO_JSON");
    try {
      Deno.env.set("ALLOW_PUBLIC_INFO_JSON", "false");
      setupStorageEnv();
      setupAdminEnv();
      mockFilesWithAlbum();

      const req = new Request("http://localhost/info?refresh=1", {
        method: "GET",
        headers: { Authorization: createAdminAuthHeader() },
      });
      await handleInfo(req, {});

      const req2 = new Request("http://localhost/info", {
        method: "GET",
        headers: { Authorization: createAdminAuthHeader() },
      });
      const response = await handleInfo(req2, {});
      assertEquals(response.status, 200);
      assertEquals(
        (response.headers.get("Cache-Control") ?? "").includes("private"),
        true,
      );
    } finally {
      if (prev === undefined) Deno.env.delete("ALLOW_PUBLIC_INFO_JSON");
      else Deno.env.set("ALLOW_PUBLIC_INFO_JSON", prev);
    }
  },
);

Deno.test("Info handler returns 304 when If-None-Match matches ETag", async () => {
  setupStorageEnv();
  setupAdminEnv();
  mockFilesWithAlbum();

  const refreshReq = new Request("http://inm.example/info?refresh=1", {
    method: "GET",
    headers: { Authorization: createAdminAuthHeader() },
  });
  const first = await handleInfo(refreshReq, {});
  assertEquals(first.status, 200);
  const etag = first.headers.get("ETag");
  assertEquals(etag != null, true);

  const second = await handleInfo(
    new Request("http://inm.example/info", {
      method: "GET",
      headers: { "If-None-Match": etag! },
    }),
    {},
  );
  assertEquals(second.status, 304);
  assertEquals(await second.text(), "");
  assertEquals(second.headers.get("ETag"), etag);
});

Deno.test(
  "Info handler ignores unparseable PUBLIC_HOSTNAME and uses request host",
  async () => {
    const prevHost = Deno.env.get("PUBLIC_HOSTNAME");
    try {
      Deno.env.set("PUBLIC_HOSTNAME", "http://[incomplete");
      setupStorageEnv();
      setupAdminEnv();
      mockFilesWithAlbum();

      const req = new Request("http://fallback-host.example/info?refresh=1", {
        method: "GET",
        headers: { Authorization: createAdminAuthHeader() },
      });
      const response = await handleInfo(req, {});
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.hostname, "fallback-host.example");
    } finally {
      if (prevHost === undefined) Deno.env.delete("PUBLIC_HOSTNAME");
      else Deno.env.set("PUBLIC_HOSTNAME", prevHost);
    }
  },
);

Deno.test(
  "Info handler uses PUBLIC_HOSTNAME for JSON hostname when env is set",
  async () => {
    const prevHost = Deno.env.get("PUBLIC_HOSTNAME");
    try {
      Deno.env.set("PUBLIC_HOSTNAME", "https://catalog.example.org/path");
      setupStorageEnv();
      setupAdminEnv();
      mockFilesWithAlbum();

      const req = new Request("http://internal-lb.local:8080/info?refresh=1", {
        method: "GET",
        headers: { Authorization: createAdminAuthHeader() },
      });
      const response = await handleInfo(req, {});
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.hostname, "catalog.example.org");
    } finally {
      if (prevHost === undefined) Deno.env.delete("PUBLIC_HOSTNAME");
      else Deno.env.set("PUBLIC_HOSTNAME", prevHost);
    }
  },
);
