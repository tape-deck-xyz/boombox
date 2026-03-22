/** @file Tests for upload route handler */
import { assert, assertEquals } from "@std/assert";
import { handleUpload } from "../../../server/handlers/upload.ts";
import {
  ADMIN_PASS,
  ADMIN_USER,
  createAdminAuthHeader,
} from "./test-utils.ts";

Deno.test({
  name: "Upload handler tests",
  async fn(t) {
    // Set up admin environment variables once for all steps
    const originalUser = Deno.env.get("ADMIN_USER");
    const originalPass = Deno.env.get("ADMIN_PASS");

    Deno.env.set("ADMIN_USER", ADMIN_USER);
    Deno.env.set("ADMIN_PASS", ADMIN_PASS);

    try {
      await t.step("rejects unauthenticated requests", async () => {
        const req = new Request("http://localhost:8000/", {
          method: "POST",
          body: new FormData(),
        });

        const response = await handleUpload(req);
        assertEquals(response.status, 401);
        assertEquals(
          response.headers.get("WWW-Authenticate"),
          'Basic realm="Admin", charset="UTF-8"',
        );
      });

      await t.step("returns 400 when no files provided", async () => {
        const formData = new FormData();
        const req = new Request("http://localhost:8000/", {
          method: "POST",
          body: formData,
          headers: { Authorization: createAdminAuthHeader() },
        });

        const response = await handleUpload(req);
        assertEquals(response.status, 400);

        const text = await response.text();
        assertEquals(text, "No files provided");
      });

      await t.step(
        "regression: does not return 400 when FormData contains files (client must build FormData before disabling file input)",
        async () => {
          const file = new File(["content"], "test.mp3", {
            type: "audio/mpeg",
          });
          const formData = new FormData();
          formData.append("files", file);
          const req = new Request("http://localhost:8000/", {
            method: "POST",
            body: formData,
            headers: { Authorization: createAdminAuthHeader() },
          });
          const response = await handleUpload(req);
          assert(
            response.status !== 400,
            "Must not return 400 when FormData includes files; client builds FormData before disabling file input",
          );
          if (response.status === 400) {
            const text = await response.text();
            assert(
              text !== "No files provided",
              "Must not return 'No files provided' when files were sent",
            );
          }
        },
      );

      await t.step("accepts FormData with files", async () => {
        // Create a simple text file for testing
        const fileContent = new Blob(["test audio content"], {
          type: "audio/mpeg",
        });
        const file = new File([fileContent], "test.mp3", {
          type: "audio/mpeg",
        });

        const formData = new FormData();
        formData.append("files", file);

        const req = new Request("http://localhost:8000/", {
          method: "POST",
          body: formData,
          headers: { Authorization: createAdminAuthHeader() },
        });

        // Note: This will fail if AWS credentials aren't configured, but we can test the structure
        const response = await handleUpload(req);

        // Should either succeed (303 redirect) or fail with 500 (if AWS not configured)
        // But should NOT be 400 (no files) or crash
        assertEquals(
          [303, 500].includes(response.status),
          true,
          "Should return 303 (success) or 500 (AWS error), not 400",
        );
      });

      await t.step("handles multiple files", async () => {
        const file1 = new File(["content1"], "test1.mp3", {
          type: "audio/mpeg",
        });
        const file2 = new File(["content2"], "test2.mp3", {
          type: "audio/mpeg",
        });

        const formData = new FormData();
        formData.append("files", file1);
        formData.append("files", file2);

        const req = new Request("http://localhost:8000/", {
          method: "POST",
          body: formData,
          headers: { Authorization: createAdminAuthHeader() },
        });

        const response = await handleUpload(req);

        // Should handle multiple files (will fail if AWS not configured, but structure is correct)
        assertEquals(
          [303, 500].includes(response.status),
          true,
          "Should handle multiple files",
        );
      });

      await t.step("accepts FormData with metadata overrides", async () => {
        const file = new File(["content"], "test.mp3", {
          type: "audio/mpeg",
        });
        const formData = new FormData();
        formData.append("files", file);
        formData.append(
          "metadata:0",
          JSON.stringify({
            artist: "Override Artist",
            album: "Override Album",
            title: "Override Title",
            trackNumber: 5,
          }),
        );

        const req = new Request("http://localhost:8000/", {
          method: "POST",
          body: formData,
          headers: { Authorization: createAdminAuthHeader() },
        });

        const response = await handleUpload(req);

        assertEquals(
          [303, 500].includes(response.status),
          true,
          "Should accept metadata override without crashing",
        );
      });
    } finally {
      // Restore original environment variables
      if (originalUser === undefined) {
        Deno.env.delete("ADMIN_USER");
      } else {
        Deno.env.set("ADMIN_USER", originalUser);
      }

      if (originalPass === undefined) {
        Deno.env.delete("ADMIN_PASS");
      } else {
        Deno.env.set("ADMIN_PASS", originalPass);
      }
    }
  },
  sanitizeResources: false, // S3Client connections are managed by AWS SDK
  sanitizeOps: false,
});
