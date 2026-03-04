/**
 * @file File upload route handler
 *
 * Handles POST `/` for uploading audio files to S3. Requires admin
 * authentication (same Basic Auth as GET `/admin`). Unauthenticated requests
 * receive 401 with a Basic Auth challenge.
 */
import type { ID3Tags } from "../../app/util/id3.ts";
import { getUploadedFiles, handleS3Upload } from "../../app/util/s3.server.ts";
import { regenerateInfoCache } from "../cache/info.ts";
import { requireAdminAuth } from "../utils/basicAuth.ts";

/**
 * Convert FormData file entry to async iterable
 */
async function* formDataToAsyncIterable(file: File): AsyncIterable<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const chunkSize = 1024;
  let offset = 0;

  while (offset < uint8Array.length) {
    const chunk = uint8Array.slice(offset, offset + chunkSize);
    offset += chunkSize;
    yield chunk;
  }
}

/**
 * Handle POST `/` — multipart file upload. Requires admin Basic Auth;
 * returns 401 if not authenticated. On success, redirects to `/` (303).
 *
 * @param req - The request; must have valid Authorization and multipart body
 * @returns 401 if not admin, 400 if no files, 500 on upload failure, 303 to /
 */
export async function handleUpload(req: Request): Promise<Response> {
  const authError = requireAdminAuth(req);
  if (authError) {
    return authError;
  }

  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return new Response("No files provided", { status: 400 });
    }

    const metadataOverrides: Array<Partial<ID3Tags> | undefined> = [];
    for (let i = 0;; i++) {
      const raw = formData.get(`metadata:${i}`);
      if (raw == null) break;
      try {
        metadataOverrides[i] = JSON.parse(raw as string) as Partial<ID3Tags>;
      } catch {
        metadataOverrides[i] = undefined;
      }
    }

    const errors: string[] = [];
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file instanceof File) {
        try {
          const data = formDataToAsyncIterable(file);
          const override = metadataOverrides[i];
          await handleS3Upload("files", file.type, data, override);
          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
          const errorName = (error as { name?: string }).name || "Unknown";
          console.error(
            `Failed to upload file ${file.name}: ${errorName} - ${errorMessage}`,
          );
          errors.push(`${file.name}: ${errorMessage}`);
          // Continue processing other files even if one fails
        }
      }
    }

    // Force refresh of file cache and regenerate info cache when uploads succeeded
    let uploadedFiles;
    try {
      uploadedFiles = await getUploadedFiles(true);
    } catch (error) {
      console.error("Failed to refresh file cache:", error);
      // Don't fail the entire request if cache refresh fails
    }

    if (successCount > 0 && uploadedFiles) {
      try {
        await regenerateInfoCache(req, uploadedFiles);
      } catch (error) {
        console.error("Failed to regenerate info cache:", error);
      }
    }

    // If all files failed, return error
    if (successCount === 0 && errors.length > 0) {
      return new Response(`Upload failed for all files: ${errors.join("; ")}`, {
        status: 500,
      });
    }

    // If some files succeeded, redirect (partial success)
    // If all succeeded, redirect (full success)
    return new Response(null, {
      status: 303,
      headers: { Location: "/" },
    });
  } catch (error) {
    console.error("Upload error:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    const errorName = (error as { name?: string }).name || "Unknown";
    console.error(`Upload error name: ${errorName}`);
    return new Response(`Upload failed: ${errorMessage}`, { status: 500 });
  }
}
