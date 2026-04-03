/** @file Info cache, S3 canonical `info.json`, and resolution for `GET /info`.
 *
 * @see `docs/library-catalog-and-info.md`
 */
import type { Files } from "../app/util/files.ts";
import { createLogger } from "../app/util/logger.ts";
import {
  getInfoJsonObjectFromS3,
  getUploadedFiles,
  headInfoJsonObjectFromS3,
  putInfoJsonObjectToS3,
} from "../app/util/s3.server.ts";
import {
  assertValidInfoDocument,
  INFO_DOCUMENT_SCHEMA_VERSION,
  normalizeContentsLegacy,
} from "./info-document.ts";

const logger = createLogger("Info");

/** Path to the on-disk cache file */
export const INFO_CACHE_PATH = "cache/info.json";

/** Persists last known S3 ETag for `info.json` (revalidation). */
export const INFO_ETAG_CACHE_PATH = "cache/info-s3.etag";

/** Disk cache considered fresh without a blocking S3 HEAD (see docs). */
export const INFO_DISK_CACHE_TTL_MS = 5 * 60 * 1000;

/** Non-production hook for tests: integer milliseconds; unset uses {@link INFO_DISK_CACHE_TTL_MS}. */
function getEffectiveDiskCacheTtlMs(): number {
  const raw = Deno.env.get("INFO_DISK_CACHE_TTL_TEST_MS");
  if (raw === undefined || raw === "") return INFO_DISK_CACHE_TTL_MS;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? INFO_DISK_CACHE_TTL_MS : Math.max(0, n);
}

/**
 * Host from `PUBLIC_HOSTNAME` when set and parseable (plain `host`, `host:port`, or URL).
 * IPv6 and ports follow `URL` rules. Returns `null` if the env value is empty or invalid.
 */
function publicHostnameFromEnv(): string | null {
  const raw = Deno.env.get("PUBLIC_HOSTNAME")?.trim();
  if (!raw) return null;
  try {
    const href = raw.includes("://") ? raw : `http://${raw}`;
    return new URL(href).hostname;
  } catch {
    return null;
  }
}

/**
 * Hostname written into catalog documents and reflected on `GET /info` JSON.
 * Uses `PUBLIC_HOSTNAME` when set and valid; otherwise the request URL host
 * (see `docs/library-catalog-and-info.md`).
 */
export function catalogHostnameForRequest(req: Request): string {
  return publicHostnameFromEnv() ?? new URL(req.url).hostname;
}

/**
 * True when `If-None-Match` satisfies a strong ETag for conditional GET (HTTP 304).
 *
 * @param ifNoneMatch - Raw `If-None-Match` header (may be comma-separated; weak ETags supported)
 * @param strongEtag - ETag without surrounding double quotes (same shape as stored sidecar / S3 normalize)
 */
export function isIfNoneMatchSatisfied(
  ifNoneMatch: string | null,
  strongEtag: string | undefined,
): boolean {
  if (strongEtag == null || strongEtag === "" || ifNoneMatch == null) {
    return false;
  }
  const target = strongEtag.replaceAll('"', "");
  for (const part of ifNoneMatch.split(",")) {
    let p = part.trim();
    if (p === "") continue;
    if (p === "*") return true;
    if (p.startsWith("W/")) p = p.slice(2).trim();
    p = p.replaceAll('"', "");
    if (p === target) return true;
  }
  return false;
}

/** Shape of the /info JSON response and persisted catalog document */
export type InfoPayload = {
  contents: Files;
  timestamp: number;
  hostname: string;
  /** Bumped when the documented JSON shape changes; see schemas/info.schema.json */
  schemaVersion: number;
};

/**
 * When unset or not `false`, `GET /info` is available without admin credentials
 * (see `docs/library-catalog-and-info.md`).
 */
export function isAllowPublicInfoJson(): boolean {
  return Deno.env.get("ALLOW_PUBLIC_INFO_JSON") !== "false";
}

/**
 * Read the info cache from disk.
 *
 * @returns Parsed payload or null if file is missing or invalid
 */
export async function readInfoCache(): Promise<InfoPayload | null> {
  try {
    const text = await Deno.readTextFile(INFO_CACHE_PATH);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof parsed?.contents !== "object" ||
      typeof parsed?.timestamp !== "number" ||
      typeof parsed?.hostname !== "string"
    ) {
      return null;
    }
    const contents = normalizeContentsLegacy(parsed.contents);
    const schemaVersion = typeof parsed.schemaVersion === "number"
      ? parsed.schemaVersion
      : 0;
    return {
      contents,
      timestamp: parsed.timestamp,
      hostname: parsed.hostname as string,
      schemaVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Write the info document to disk after JSON Schema validation.
 *
 * @param payload - The document to persist
 */
export async function writeInfoCache(payload: InfoPayload): Promise<void> {
  assertValidInfoDocument(payload);
  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(
    INFO_CACHE_PATH,
    JSON.stringify(payload),
  );
}

/** Last persisted S3 ETag for `info.json` (after put or download). */
export function getCachedInfoS3Etag(): Promise<string | null> {
  return readStoredS3Etag();
}

async function readStoredS3Etag(): Promise<string | null> {
  try {
    const t = (await Deno.readTextFile(INFO_ETAG_CACHE_PATH)).trim();
    return t || null;
  } catch {
    return null;
  }
}

async function writeStoredS3Etag(etag: string): Promise<void> {
  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(INFO_ETAG_CACHE_PATH, etag);
}

async function getDiskCacheMtimeMs(): Promise<number | null> {
  try {
    const s = await Deno.stat(INFO_CACHE_PATH);
    return s.mtime?.getTime() ?? null;
  } catch {
    return null;
  }
}

function parsePayloadFromS3Json(text: string): InfoPayload | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed?.contents !== "object" || parsed.contents === null) {
      return null;
    }
    if (typeof parsed.timestamp !== "number") return null;
    const hostname = typeof parsed.hostname === "string" ? parsed.hostname : "";
    let schemaVersion = typeof parsed.schemaVersion === "number"
      ? parsed.schemaVersion
      : INFO_DOCUMENT_SCHEMA_VERSION;
    if (schemaVersion < 1) schemaVersion = INFO_DOCUMENT_SCHEMA_VERSION;
    const contents = normalizeContentsLegacy(parsed.contents);
    const payload: InfoPayload = {
      contents,
      timestamp: parsed.timestamp,
      hostname,
      schemaVersion,
    };
    assertValidInfoDocument(payload);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Regenerate the info cache with fresh data from S3 listing; persist to disk and `info.json`.
 *
 * @param req - Request used to derive hostname in the persisted payload
 * @param files - Optional pre-fetched files; if omitted, fetches from S3
 * @returns The generated document
 */
export async function regenerateInfoCache(
  req: Request,
  files?: Files,
): Promise<InfoPayload> {
  const hostname = catalogHostnameForRequest(req);
  const contents = files ?? await getUploadedFiles(true);
  const payload: InfoPayload = {
    contents,
    timestamp: Date.now(),
    hostname,
    schemaVersion: INFO_DOCUMENT_SCHEMA_VERSION,
  };
  await writeInfoCache(payload);
  try {
    const etag = await putInfoJsonObjectToS3(JSON.stringify(payload));
    await writeStoredS3Etag(etag);
  } catch (e) {
    logger.warn("Could not persist info.json to S3", { error: String(e) });
  }
  return payload;
}

/**
 * Resolve catalog for a normal `GET /info` (not `?refresh=1`): disk TTL, S3 revalidation,
 * then rebuild from listing with a warning if needed.
 */
export async function resolveInfoPayloadForGet(req: Request): Promise<{
  payload: InfoPayload;
  etagForHttp: string | undefined;
}> {
  const diskPayload = await readInfoCache();

  if (diskPayload) {
    const mtime = await getDiskCacheMtimeMs();
    const ageMs = mtime != null ? Date.now() - mtime : 0;
    if (ageMs < getEffectiveDiskCacheTtlMs()) {
      const etag = await readStoredS3Etag();
      return { payload: diskPayload, etagForHttp: etag ?? undefined };
    }

    try {
      const head = await headInfoJsonObjectFromS3();
      const stored = await readStoredS3Etag();
      if (head && stored && head.etag === stored) {
        return { payload: diskPayload, etagForHttp: stored };
      }
      const got = await getInfoJsonObjectFromS3();
      if (got) {
        const parsed = parsePayloadFromS3Json(got.bodyText);
        if (parsed) {
          await writeInfoCache(parsed);
          await writeStoredS3Etag(got.etag);
          return { payload: parsed, etagForHttp: got.etag };
        }
      }
    } catch {
      // use disk
    }
    const etag = await readStoredS3Etag();
    return { payload: diskPayload, etagForHttp: etag ?? undefined };
  }

  const got = await getInfoJsonObjectFromS3().catch(() => null);
  if (got) {
    const parsed = parsePayloadFromS3Json(got.bodyText);
    if (parsed) {
      await writeInfoCache(parsed);
      await writeStoredS3Etag(got.etag);
      return { payload: parsed, etagForHttp: got.etag };
    }
  }

  logger.warn(
    "info.json missing or invalid in S3 and on disk; rebuilding from object listing",
  );
  const payload = await regenerateInfoCache(req);
  const etag = await readStoredS3Etag();
  return { payload, etagForHttp: etag ?? undefined };
}

/** Inject the public/catalog hostname into the payload (`GET /info` response body). */
export function withRequestHostname(
  payload: InfoPayload,
  req: Request,
): InfoPayload {
  return {
    ...payload,
    hostname: catalogHostnameForRequest(req),
  };
}

/**
 * One-shot startup: ensure `info.json` exists in S3 when the bucket is empty of it.
 */
export async function ensureInfoJsonSeededAtStartup(): Promise<void> {
  let exists = false;
  try {
    const head = await headInfoJsonObjectFromS3();
    exists = head != null;
  } catch {
    exists = false;
  }
  if (exists) return;

  const local = await readInfoCache();
  if (local) {
    try {
      const etag = await putInfoJsonObjectToS3(JSON.stringify(local));
      await writeStoredS3Etag(etag);
    } catch (e) {
      logger.warn("Startup: could not upload info.json from local cache", {
        error: String(e),
      });
    }
    return;
  }

  const req = new Request("http://localhost/");
  try {
    await regenerateInfoCache(req);
  } catch (e) {
    logger.warn("Startup: could not generate initial info.json", {
      error: String(e),
    });
  }
}
