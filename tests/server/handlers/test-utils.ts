// deno-coverage-ignore-file
/** @file Shared test utilities for server handler tests.
 *
 * Provides setup functions and mocks used by info, index, album, and upload
 * handler tests.
 */
import { setSendBehavior } from "../s3.server.test-mocks/s3-client.ts";

export const ADMIN_USER = "admin";
export const ADMIN_PASS = "secret";

export function setupStorageEnv(): void {
  Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
  Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
  Deno.env.set("STORAGE_REGION", "test-region");
  Deno.env.set("STORAGE_BUCKET", "test-bucket");
}

export function setupAdminEnv(): void {
  Deno.env.set("ADMIN_USER", ADMIN_USER);
  Deno.env.set("ADMIN_PASS", ADMIN_PASS);
}

export function createAdminAuthHeader(): string {
  return `Basic ${globalThis.btoa(`${ADMIN_USER}:${ADMIN_PASS}`)}`;
}

export function mockFilesWithAlbum(): void {
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
