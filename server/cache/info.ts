/** @file Info endpoint cache - file-based cache for /info JSON payload */
import type { Files } from "../../app/util/files.ts";
import { getUploadedFiles } from "../../app/util/s3.server.ts";

/** Path to the info cache file */
export const INFO_CACHE_PATH = "cache/info.json";

/** Shape of the /info JSON response */
export type InfoPayload = {
  contents: Files;
  timestamp: number;
  hostname: string;
};

/**
 * Read the info cache from disk.
 *
 * @returns Parsed payload or null if file is missing or invalid
 */
export async function readInfoCache(): Promise<InfoPayload | null> {
  try {
    const text = await Deno.readTextFile(INFO_CACHE_PATH);
    const parsed = JSON.parse(text) as InfoPayload;
    if (
      typeof parsed?.contents !== "object" ||
      typeof parsed?.timestamp !== "number" ||
      typeof parsed?.hostname !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the info payload to the cache file.
 *
 * @param payload - The payload to persist
 */
export async function writeInfoCache(payload: InfoPayload): Promise<void> {
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
 * @returns The generated payload
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
  };
  await writeInfoCache(payload);
  return payload;
}
