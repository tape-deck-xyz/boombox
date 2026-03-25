/** @file Info endpoint cache - file-based cache for /info JSON document */
import type { Files } from "../app/util/files.ts";
import { getUploadedFiles } from "../app/util/s3.server.ts";
import {
  assertValidInfoDocument,
  INFO_DOCUMENT_SCHEMA_VERSION,
  normalizeContentsLegacy,
} from "./info-document.ts";

/** Path to the info cache file */
export const INFO_CACHE_PATH = "cache/info.json";

/** Shape of the /info JSON response and on-disk `cache/info.json` document */
export type InfoPayload = {
  contents: Files;
  timestamp: number;
  hostname: string;
  /** Bumped when the documented JSON shape changes; see schemas/info.schema.json */
  schemaVersion: number;
};

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

/**
 * Regenerate the info cache with fresh data from S3.
 *
 * @param req - Request used to derive hostname
 * @param files - Optional pre-fetched files; if omitted, fetches from S3
 * @returns The generated document
 */
export async function regenerateInfoCache(
  req: Request,
  files?: Files,
): Promise<InfoPayload> {
  const hostname = new URL(req.url).hostname;
  const contents = files ?? await getUploadedFiles(true);
  const payload: InfoPayload = {
    contents,
    timestamp: Date.now(),
    hostname,
    schemaVersion: INFO_DOCUMENT_SCHEMA_VERSION,
  };
  await writeInfoCache(payload);
  return payload;
}
