/** @file Utilities for working with AWS S3.
 *
 * Handles uploads, listing, and object retrieval. {@link getObjectBytes} is used
 * by the album cover handler to fetch track bytes for ID3 extraction.
 */
import type { Files } from "./files.ts";

import type { ID3Tags } from "./id3.ts";
import { getID3Tags } from "./id3.ts";
import { deriveTrackMetadata } from "./track-metadata.ts";
import { fromEnv } from "@aws-sdk/credential-providers";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createLogger } from "./logger.ts";

// Create logger instance for S3 operations
// Can be controlled via S3_LOG_LEVEL env var, or falls back to LOG_LEVEL
const logger = createLogger("S3", "S3_LOG_LEVEL");

// Move environment validation into a function that's called during runtime
// rather than during module initialization
const validateConfig = () => {
  logger.debug("Validating S3 configuration...");

  const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
  const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const STORAGE_REGION = Deno.env.get("STORAGE_REGION");
  const STORAGE_BUCKET = Deno.env.get("STORAGE_BUCKET");

  logger.debug("Configuration check:", {
    hasAccessKey: !!AWS_ACCESS_KEY_ID,
    hasSecretKey: !!AWS_SECRET_ACCESS_KEY,
    region: STORAGE_REGION,
    bucket: STORAGE_BUCKET,
  });

  if (
    !(
      AWS_ACCESS_KEY_ID &&
      AWS_SECRET_ACCESS_KEY &&
      STORAGE_REGION &&
      STORAGE_BUCKET
    )
  ) {
    logger.error(
      "Storage configuration validation failed - missing required environment variables",
    );
    throw new Error(`Storage is missing required configuration.`);
  }

  logger.debug("Configuration validated successfully");
  return {
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    STORAGE_REGION,
    STORAGE_BUCKET,
  };
};

// Reading ////////////////////////////////////////////////////////////////////

/**
 * Fetch an object from S3 by key and return its body as bytes.
 *
 * @param key - S3 object key (e.g. "Artist/Album/1__Title.mp3")
 * @returns The object body as Uint8Array
 * @throws Error if the object does not exist or fetch fails
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const config = validateConfig();
  const client = new S3Client({
    region: config.STORAGE_REGION,
    credentials: fromEnv(),
  });
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.STORAGE_BUCKET,
      Key: key,
    }),
  );
  if (!response.Body) {
    throw new Error(`S3 object empty: ${key}`);
  }
  const bytes = new Uint8Array(
    await new Response(response.Body as ReadableStream).arrayBuffer(),
  );
  return bytes;
}

// Uploading //////////////////////////////////////////////////////////////////

/**
 * Given an array buffer, create an async generator that returns chunks of the buffer
 * @param arrayBuffer ArrayBuffer of file
 * @param chunkSize How large individual file chunks should be
 */
export async function* createAsyncIteratorFromArrayBuffer(
  arrayBuffer: ArrayBuffer,
  chunkSize = 1024,
) {
  const uint8Array = new Uint8Array(arrayBuffer);
  const totalSize = uint8Array.length;
  const totalChunks = Math.ceil(totalSize / chunkSize);

  logger.debug(`Creating async iterator from ArrayBuffer`, {
    totalSize,
    chunkSize,
    totalChunks,
  });

  let offset = 0;
  let chunkIndex = 0;

  while (offset < uint8Array.length) {
    const chunk = uint8Array.slice(offset, offset + chunkSize);
    offset += chunkSize;
    chunkIndex++;

    logger.debug(`Yielding chunk ${chunkIndex}/${totalChunks}`, {
      chunkSize: chunk.length,
      offset,
      remaining: totalSize - offset,
    });

    yield chunk;
  }

  logger.debug(
    `Finished creating async iterator - processed ${chunkIndex} chunks`,
  );
}

/** Upload file to S3 */
export async function uploadStreamToS3(
  data: AsyncIterable<Uint8Array>,
  filename: string,
) {
  logger.info(`Starting upload to S3: ${filename}`);
  const startTime = Date.now();

  const config = validateConfig();

  logger.debug("Creating S3 client", {
    region: config.STORAGE_REGION,
    bucket: config.STORAGE_BUCKET,
  });

  const client = new S3Client({
    region: config.STORAGE_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });

  logger.debug("Collecting chunks from async iterable...");
  // Collect all chunks into a single Uint8Array
  const chunks: Uint8Array[] = [];
  let chunkCount = 0;
  for await (const chunk of data) {
    chunks.push(chunk);
    chunkCount++;
    logger.debug(`Collected chunk ${chunkCount}`, {
      chunkSize: chunk.length,
    });
  }

  logger.debug(`Finished collecting ${chunkCount} chunks`);

  // Calculate total length
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  logger.info(
    `Total file size: ${totalLength} bytes (${
      (totalLength / 1024 / 1024).toFixed(2)
    } MB)`,
  );

  // Combine all chunks into a single Uint8Array
  logger.debug("Combining chunks into single Uint8Array...");
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  logger.debug("Chunks combined successfully");

  // Upload to S3
  logger.info(`Uploading to S3: ${config.STORAGE_BUCKET}/${filename}`);
  const command = new PutObjectCommand({
    Bucket: config.STORAGE_BUCKET,
    Key: filename,
    Body: combined,
  });

  try {
    const uploadStartTime = Date.now();
    await client.send(command);
    const uploadDuration = Date.now() - uploadStartTime;

    logger.info(`Upload completed successfully in ${uploadDuration}ms`, {
      filename,
      size: totalLength,
      duration: uploadDuration,
      speed: `${
        (totalLength / 1024 / 1024 / (uploadDuration / 1000)).toFixed(2)
      } MB/s`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    const errorName = (error as { name?: string }).name || "Unknown";

    logger.error(`Upload failed for ${filename}`, {
      errorName,
      errorMessage,
      size: totalLength,
      duration: Date.now() - startTime,
    });

    throw error;
  }

  const url =
    `https://${config.STORAGE_BUCKET}.s3.${config.STORAGE_REGION}.amazonaws.com/${filename}`;
  logger.info(
    `Upload finished. Total time: ${Date.now() - startTime}ms. URL: ${url}`,
  );

  return url;
}

// S3 Folder Structure //////////////////////////////////////////////////////////
// Bucket:
// - Metadata
// -- playcounts.csv
// -- likes.csv
// -- playlists.csv
// - App
// - Music
// -- [Artist]
// --- [Album]
// ---- cover.jpeg
// ---- [Tracks...]

/**
 * Handler for streaming files to S3. Extracts ID3 data from
 * files to organize into artist/album bucket structure.
 * Optional metadataOverride from client can override artist, album, title, trackNumber.
 * This replaces the Remix UploadHandler interface.
 */
export async function handleS3Upload(
  name: string,
  contentType: string,
  data: AsyncIterable<Uint8Array>,
  metadataOverride?: Partial<ID3Tags>,
): Promise<string | undefined> {
  logger.info(`handleS3Upload called`, {
    name,
    contentType,
  });

  const startTime = Date.now();
  const config = validateConfig();

  if (name !== "files") {
    logger.debug(`Skipping upload - name "${name}" does not match "files"`);
    return undefined;
  }

  logger.info("Collecting file data from stream...");
  // Collect file data
  const dataArray: BlobPart[] = [];
  let streamChunkCount = 0;
  let totalStreamBytes = 0;

  for await (const x of data) {
    streamChunkCount++;
    totalStreamBytes += x.length;

    logger.debug(`Processing stream chunk ${streamChunkCount}`, {
      chunkSize: x.length,
      totalBytesSoFar: totalStreamBytes,
    });

    // Convert Uint8Array to ArrayBuffer for File constructor
    // Ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
    if (x.buffer instanceof ArrayBuffer) {
      const buffer = x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
      dataArray.push(buffer);
    } else {
      // Fallback: create new ArrayBuffer and copy data
      logger.debug("Using fallback ArrayBuffer creation method");
      const buffer = new ArrayBuffer(x.length);
      new Uint8Array(buffer).set(x);
      dataArray.push(buffer);
    }
  }

  logger.info(
    `Collected ${streamChunkCount} chunks, total ${totalStreamBytes} bytes`,
  );

  logger.debug("Creating File object from collected data...");
  const file = new File(dataArray, "temp", { type: contentType });
  const fileArrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(fileArrayBuffer);

  logger.debug("File object created", {
    fileSize: file.size,
    arrayBufferSize: fileArrayBuffer.byteLength,
    uint8ArrayLength: uint8Array.length,
  });

  // 1. Get file metadata
  logger.info("Extracting ID3 tags from audio file...");
  let id3Tags;
  try {
    const id3StartTime = Date.now();
    id3Tags = await getID3Tags(uint8Array);
    const id3Duration = Date.now() - id3StartTime;

    logger.info("ID3 tags extracted successfully", {
      duration: id3Duration,
      artist: id3Tags.artist,
      album: id3Tags.album,
      title: id3Tags.title,
      trackNumber: id3Tags.trackNumber,
      hasImage: !!id3Tags.image,
      imageSize: id3Tags.image ? id3Tags.image.length : 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    const errorName = (error as { name?: string }).name || "Unknown";

    logger.error(`Failed to extract ID3 tags from file`, {
      errorName,
      errorMessage,
      fileSize: uint8Array.length,
    });

    throw new Error(
      `Failed to extract metadata from audio file: ${errorMessage}`,
    );
  }

  if (metadataOverride) {
    // Empty overrides must not replace server defaults: when client sends ""
    // (e.g. getID3TagsFromFile returns null for non-MP3), spreading would
    // overwrite "Unknown" with "" and produce S3 keys like //1__ which
    // file listing skips (!artist || !album)
    const filtered = { ...metadataOverride };
    if (filtered.artist === "") delete filtered.artist;
    if (filtered.album === "") delete filtered.album;
    if (filtered.title === "") delete filtered.title;
    id3Tags = { ...id3Tags, ...filtered };
  }
  id3Tags.trackNumber = Math.max(1, id3Tags.trackNumber ?? 1);

  // 2. Handle cover image
  if (id3Tags.image) {
    const albumPath = `${id3Tags.artist}/${id3Tags.album}/cover.jpeg`;
    logger.info(`Processing cover image: ${albumPath}`);

    const client = new S3Client({
      region: config.STORAGE_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });

    try {
      // 2.1 Check if cover image exists
      logger.debug(`Checking if cover image exists: ${albumPath}`);
      const headCommand = new HeadObjectCommand({
        Bucket: config.STORAGE_BUCKET,
        Key: albumPath,
      });
      await client.send(headCommand);
      logger.info(`Cover image already exists, skipping upload: ${albumPath}`);
    } catch (error) {
      // 2.2 If cover doesn't exist, upload it
      if (
        error instanceof NoSuchKey ||
        (error as { name?: string }).name === "NotFound"
      ) {
        logger.info(`Cover image not found, uploading: ${albumPath}`);
        try {
          // Convert base64 image to Uint8Array (replacing Buffer)
          // Handle any image format and optional whitespace after comma
          logger.debug("Converting base64 image to Uint8Array...");
          const base64Data = id3Tags.image.replace(
            /^data:[^;]+;base64,\s*/,
            "",
          );
          // Convert base64 to Uint8Array
          const binaryString = atob(base64Data);
          const imageBuffer = Uint8Array.from(
            binaryString,
            (c) => c.charCodeAt(0),
          );

          logger.debug("Cover image converted", {
            base64Length: base64Data.length,
            imageBufferSize: imageBuffer.length,
          });

          const putCommand = new PutObjectCommand({
            Bucket: config.STORAGE_BUCKET,
            Key: albumPath,
            Body: imageBuffer,
            ContentType: "image/jpeg",
          });

          const coverUploadStart = Date.now();
          await client.send(putCommand);
          const coverUploadDuration = Date.now() - coverUploadStart;

          logger.info(
            `Cover image uploaded successfully in ${coverUploadDuration}ms`,
            {
              albumPath,
              size: imageBuffer.length,
            },
          );
        } catch (uploadError) {
          // Log but don't fail the entire upload if cover image upload fails
          const errorMessage = uploadError instanceof Error
            ? uploadError.message
            : "Unknown error";
          const errorName = (uploadError as { name?: string }).name ||
            "Unknown";

          logger.error(
            `Failed to upload cover image for ${albumPath}`,
            {
              errorName,
              errorMessage,
              albumPath,
            },
          );
          // Continue with audio file upload even if cover image fails
        }
      } else {
        // Log other errors (permissions, network, etc.) but continue with upload
        const errorMessage = error instanceof Error
          ? error.message
          : "Unknown error";
        const errorName = (error as { name?: string }).name || "Unknown";

        logger.error(
          `Error checking cover image for ${albumPath}`,
          {
            errorName,
            errorMessage,
            albumPath,
          },
        );
        // Continue with audio file upload even if cover check fails
      }
    }
  } else {
    logger.debug("No cover image found in ID3 tags, skipping cover upload");
  }

  // 3. Upload audio file
  const partitionedFilename =
    `${id3Tags.artist}/${id3Tags.album}/${id3Tags.trackNumber}__${id3Tags.title}`;
  logger.info(`Uploading audio file: ${partitionedFilename}`);

  const uploadedFileLocation = await uploadStreamToS3(
    createAsyncIteratorFromArrayBuffer(fileArrayBuffer),
    partitionedFilename,
  );

  const totalDuration = Date.now() - startTime;
  logger.info(`handleS3Upload completed successfully in ${totalDuration}ms`, {
    uploadedFileLocation,
    filename: partitionedFilename,
  });

  return uploadedFileLocation;
}

// Reading ////////////////////////////////////////////////////////////////////

/**
 * Public HTTPS URL for an album’s `cover.jpeg` object (same shape as track URLs).
 */
export function buildPublicCoverArtUrl(
  artist: string,
  album: string,
  bucket: string,
  region: string,
): string {
  const key = `${artist}/${album}/cover.jpeg`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * S3 object key for stored cover art (`artist/album/cover.jpeg`).
 */
export function coverObjectKey(artist: string, album: string): string {
  return `${artist}/${album}/cover.jpeg`;
}

/** File fetch cache to avoid repetitve fetches */
let filesFetchCache: Promise<Files> | null = null;

/** Get file list from S3 and organize it into a `Files` object */
const fileFetch = async (): Promise<Files> => {
  logger.info("Fetching file list from S3...");
  const startTime = Date.now();

  const config = validateConfig();

  logger.debug("Creating S3 client for file listing", {
    region: config.STORAGE_REGION,
    bucket: config.STORAGE_BUCKET,
  });

  const client = new S3Client({
    region: config.STORAGE_REGION,
    credentials: fromEnv(),
  });
  const command = new ListObjectsV2Command({
    Bucket: config.STORAGE_BUCKET,
  });

  try {
    let isTruncated = true;
    const files: Files = {};
    /** Album ids `artist/album` (decoded) that have a `cover.jpeg` object in the listing. */
    const coverPresent = new Set<string>();
    let pageCount = 0;
    let totalObjects = 0;

    while (isTruncated) {
      pageCount++;
      logger.debug(`Fetching page ${pageCount} of S3 objects...`);

      const { Contents, IsTruncated, NextContinuationToken } = await client
        .send(command);

      if (!Contents) {
        logger.info(
          "No contents returned from S3, returning empty files object",
        );
        return files;
      }

      logger.debug(`Page ${pageCount} returned ${Contents.length} objects`);
      totalObjects += Contents.length;

      for (const cur of Contents) {
        if (!cur.Key) continue;
        const keyParts = cur.Key.split("/");

        // Validate: must have exactly 3 parts (artist/album/track)
        if (keyParts.length !== 3) {
          logger.warn(
            `Skipping invalid file structure: ${cur.Key} (expected artist/album/track)`,
          );
          continue;
        }

        let [artist, album] = keyParts;
        const lastSegment = keyParts[2];

        // Decode URL-encoded artist and album names from S3 keys
        // S3 keys may be URL-encoded (e.g., "Childish%20Gambino" -> "Childish Gambino")
        try {
          artist = decodeURIComponent(artist);
          album = decodeURIComponent(album);
        } catch {
          // If decoding fails, use as-is (already decoded or invalid)
        }

        // Validate: artist and album must exist
        if (!artist || !album || !lastSegment) {
          logger.warn(`Skipping file with missing parts: ${cur.Key}`);
          continue;
        }

        if (lastSegment.toLowerCase() === "cover.jpeg") {
          coverPresent.add(`${artist}/${album}`);
          continue;
        }

        // Validate: track filename must have __ separator
        const trackWNum = lastSegment;
        if (!trackWNum.includes("__")) {
          logger.warn(
            `Skipping invalid track filename format: ${cur.Key} (expected number__title or cover.jpeg)`,
          );
          continue;
        }

        const trackUrl =
          `https://${config.STORAGE_BUCKET}.s3.${config.STORAGE_REGION}.amazonaws.com/${cur.Key}`;
        const trackMetadata = await deriveTrackMetadata(trackUrl, {
          skipId3: true,
        });
        const trackNum = trackMetadata.trackNumber;

        // Validate: track number must be a valid number
        if (!Number.isFinite(trackNum) || trackNum <= 0) {
          logger.warn(`Skipping file with invalid track number: ${cur.Key}`);
          continue;
        }

        logger.debug(`Processing valid track: ${cur.Key}`, {
          artist,
          album,
          trackNum,
          title: trackMetadata.title,
        });

        // All validations passed, proceed with adding to files
        files[artist] = files[artist] || {};
        files[artist][album] = files[artist][album] || {
          id: `${artist}/${album}`,
          title: album,
          coverArtUrl: null,
          tracks: [],
        };
        files[artist][album].tracks.push({
          title: trackMetadata.title || "Unknown",
          trackNum,
          lastModified: cur.LastModified?.valueOf() || null,
          url: trackUrl,
        });
      }

      isTruncated = Boolean(IsTruncated);
      command.input.ContinuationToken = NextContinuationToken;

      logger.debug(`Page ${pageCount} processed`, {
        isTruncated,
        hasNextToken: !!NextContinuationToken,
      });
    }

    const duration = Date.now() - startTime;
    const artistCount = Object.keys(files).length;
    let albumCount = 0;
    let trackCount = 0;

    for (const artist of Object.values(files)) {
      albumCount += Object.keys(artist).length;
      for (const album of Object.values(artist)) {
        trackCount += album.tracks.length;
      }
    }

    logger.info(`File fetch completed successfully in ${duration}ms`, {
      totalObjects,
      pages: pageCount,
      artists: artistCount,
      albums: albumCount,
      tracks: trackCount,
    });

    for (const [artistName, albumsMap] of Object.entries(files)) {
      for (const [albumName, albumObj] of Object.entries(albumsMap)) {
        const albumKey = `${artistName}/${albumName}`;
        albumObj.coverArtUrl = coverPresent.has(albumKey)
          ? buildPublicCoverArtUrl(
            artistName,
            albumName,
            config.STORAGE_BUCKET,
            config.STORAGE_REGION,
          )
          : null;
      }
    }

    return files;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const errorName = (err as { name?: string }).name || "Unknown";

    logger.error(`File fetch failed`, {
      errorName,
      errorMessage,
      duration: Date.now() - startTime,
    });

    throw err;
  }
};

/**
 * Get Files object
 * @param force Optionally force a fresh data pull. Otherwise data will be pulled from cache if available.
 */
export const getUploadedFiles = (force?: boolean): Promise<Files> => {
  if (force) {
    logger.info(
      "Force refresh requested, clearing cache and fetching fresh data",
    );
    filesFetchCache = null;
  }

  if (!filesFetchCache) {
    logger.debug("Cache miss, fetching files from S3");
    filesFetchCache = fileFetch();
  } else {
    logger.debug("Using cached file list");
  }

  return filesFetchCache;
};
