/** @file ID3 (audio metadata) related functionality */
import { fromUrl } from "id3js";
import * as musicMetadata from "music-metadata";
import { parseBlob } from "music-metadata-browser";

/** Normalized ID3 tags */
export type ID3Tags = {
  artist: string;
  album: string;
  image?: string;
  title: string;
  trackNumber: number;
};

/**
 * Converts image data to JPEG format using Canvas
 * NOTE: This function is BROWSER-ONLY and requires DOM APIs (Image, Canvas, Blob, URL)
 * For server-side use, use getID3Tags which already provides base64-encoded images
 * @param imageData Original image data
 * @param format Original image format
 * @returns JPEG image as Uint8Array
 * @throws Error if called in a server environment
 */
const convertToJpeg = async (
  imageData: Uint8Array,
  format: string,
): Promise<Uint8Array> => {
  // Check if we're in a browser environment
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error(
      "convertToJpeg is browser-only. Use getID3Tags for server-side image extraction.",
    );
  }

  // Ensure we have a proper ArrayBuffer for Blob (not SharedArrayBuffer)
  const arrayBuffer = imageData.buffer instanceof ArrayBuffer
    ? imageData.buffer.slice(
      imageData.byteOffset,
      imageData.byteOffset + imageData.byteLength,
    )
    : new ArrayBuffer(imageData.length);
  if (!(imageData.buffer instanceof ArrayBuffer)) {
    new Uint8Array(arrayBuffer).set(imageData);
  }
  const blob = new Blob([arrayBuffer], { type: format });
  const imageUrl = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Could not get canvas context");
    }

    ctx.drawImage(img, 0, 0);

    const jpegUrl = canvas.toDataURL("image/jpeg", 0.9);
    const base64Data = jpegUrl.split(",")[1];
    return new Uint8Array(
      atob(base64Data)
        .split("")
        .map((char) => char.charCodeAt(0)),
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

/**
 * Extracts the cover image from an audio file and converts it to JPEG
 * NOTE: This function is BROWSER-ONLY and requires DOM APIs
 * For server-side use, use getID3Tags which already provides base64-encoded images
 * @param file Audio file to extract cover art from
 * @returns Object containing the JPEG image data, or null if no image found
 * @throws Error if called in a server environment
 */
export const extractCoverImage = async (
  file: File,
): Promise<{ data: Uint8Array; format: "image/jpeg" } | null> => {
  // Check if we're in a browser environment
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error(
      "extractCoverImage is browser-only. Use getID3Tags for server-side image extraction.",
    );
  }
  try {
    const metadata = await parseBlob(file);
    const picture = metadata.common.picture?.[0];

    if (!picture) {
      return null;
    }

    // Convert picture.data to Uint8Array
    // music-metadata may return Buffer (Node.js) or Uint8Array
    // Use type assertion to handle both cases
    const rawData = picture.data as Uint8Array | ArrayLike<number>;
    let imageData: Uint8Array;

    if (rawData instanceof Uint8Array) {
      imageData = rawData;
    } else if (rawData && typeof rawData.length === "number") {
      // Handle Buffer or other array-like types
      // Create a new Uint8Array by copying the data
      imageData = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        imageData[i] = rawData[i];
      }
    } else {
      throw new Error("Unsupported picture data type");
    }

    const jpegData = await convertToJpeg(imageData, picture.format);

    return {
      data: jpegData,
      format: "image/jpeg",
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    throw new Error(`Failed to extract cover image: ${errorMessage}`);
  }
};

/**
 * Get an object of basic, normalized ID3 tags
 * @param file File to pull metadata from
 * @returns An object of normalized ID3 tags
 */
export const getID3Tags = async (file: Uint8Array): Promise<ID3Tags> => {
  const metadata = await musicMetadata.parseBuffer(file);

  let image;

  const imageMetadata = metadata.common.picture && metadata.common.picture[0];

  if (imageMetadata) {
    // Convert Uint8Array to base64 (replacing Buffer)
    // Process in chunks to avoid stack overflow with large images
    const uint8Array = new Uint8Array(imageMetadata.data);
    const chunkSize = 8192; // Process 8KB at a time
    let binaryString = "";

    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      binaryString += String.fromCharCode(...chunk);
    }

    const contents_in_base64 = btoa(binaryString);
    const withPrefix =
      `data:${imageMetadata.format};base64,${contents_in_base64}`;
    image = withPrefix;
  }

  return {
    title: metadata.common.title || "Unknown",
    album: metadata.common.album || "Unknown",
    trackNumber: Number(metadata.common.track.no),
    artist: metadata.common.artist || "Unknown",
    image,
  };
};

/** Pull ID3 tags from file at `url` */
export const getID3TagsFromURL = (url: string) => fromUrl(url);
