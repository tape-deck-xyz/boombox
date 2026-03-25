/** @file Tests for album cover route handler */
import { assertEquals } from "@std/assert";
import { decodeDataUrl } from "../../../app/util/data-url.ts";
import { getUploadedFiles } from "../../../app/util/s3.server.ts";
import {
  clearAlbumCoverHandlerCache,
  getKeyFromTrackUrl,
  handleAlbumCover,
} from "../../../server/handlers/album.cover.ts";
import { setupStorageEnv } from "./test-utils.ts";
import { setSendBehavior } from "../s3.server.test-mocks/s3-client.ts";
import { setGetID3TagsReturn } from "../s3.server.test-mocks/id3.ts";

Deno.test("Album cover handler returns 400 when artistId is missing", async () => {
  const req = new Request(
    "http://localhost:8000/artists//albums/SomeAlbum/cover",
  );
  const response = await handleAlbumCover(req, {
    artistId: "",
    albumId: "SomeAlbum",
  });
  assertEquals(response.status, 400);
  const text = await response.text();
  assertEquals(text, "Missing artist or album ID");
});

Deno.test("Album cover handler returns 400 when albumId is missing", async () => {
  const req = new Request(
    "http://localhost:8000/artists/SomeArtist/albums//cover",
  );
  const response = await handleAlbumCover(req, {
    artistId: "SomeArtist",
    albumId: "",
  });
  assertEquals(response.status, 400);
  const text = await response.text();
  assertEquals(text, "Missing artist or album ID");
});

Deno.test("decodeDataUrl returns body and contentType for valid data URL", () => {
  const dataUrl = "data:image/jpeg;base64,/9j/4AAQ";
  const result = decodeDataUrl(dataUrl);
  assertEquals(result !== null, true);
  if (result) {
    assertEquals(result.contentType, "image/jpeg");
    assertEquals(result.body instanceof Uint8Array, true);
    assertEquals(result.body.length > 0, true);
  }
});

Deno.test("getKeyFromTrackUrl extracts S3 key from track URL", () => {
  const url =
    "https://my-bucket.s3.us-east-1.amazonaws.com/Artist%20Name/Album%20Name/1__Song.mp3";
  const key = getKeyFromTrackUrl(url);
  assertEquals(key, "Artist Name/Album Name/1__Song.mp3");
});

Deno.test(
  "getKeyFromTrackUrl leaves pathname as-is when decodeURIComponent fails",
  () => {
    const url =
      "https://my-bucket.s3.us-east-1.amazonaws.com/%E0%A4%A/1__x.mp3";
    const key = getKeyFromTrackUrl(url);
    assertEquals(key, "%E0%A4%A/1__x.mp3");
  },
);

Deno.test("decodeDataUrl returns null for invalid data URL", () => {
  assertEquals(decodeDataUrl("not-a-data-url"), null);
  assertEquals(decodeDataUrl("data:image/jpeg;base64,!!"), null); // invalid base64
});

Deno.test("Album cover handler serves S3 cover.jpeg when object exists", async () => {
  setupStorageEnv();
  clearAlbumCoverHandlerCache();
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "ListObjectsV2Command") {
      return Promise.resolve({
        Contents: [
          {
            Key: "Test Artist/Test Album/1__Test Track.mp3",
            LastModified: new Date(),
          },
          {
            Key: "Test Artist/Test Album/cover.jpeg",
            LastModified: new Date(),
          },
        ],
        IsTruncated: false,
      });
    }
    if (name === "GetObjectCommand") {
      const input = (command as { input: { Key: string } }).input;
      if (input.Key === "Test Artist/Test Album/cover.jpeg") {
        const stream = new Response(jpegBytes).body!;
        return Promise.resolve({ Body: stream });
      }
    }
    return Promise.resolve({});
  });

  await getUploadedFiles(true);

  const req = new Request(
    "http://localhost:8000/artists/Test%20Artist/albums/Test%20Album/cover",
  );
  const response = await handleAlbumCover(req, {
    artistId: "Test Artist",
    albumId: "Test Album",
  });

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/jpeg");
  const out = new Uint8Array(await response.arrayBuffer());
  assertEquals(out, jpegBytes);
});

Deno.test(
  "Album cover handler returns cached body without re-fetching S3",
  async () => {
    setupStorageEnv();
    clearAlbumCoverHandlerCache();
    let getObjectCalls = 0;
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    setSendBehavior((command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        ?.name;
      if (name === "ListObjectsV2Command") {
        return Promise.resolve({
          Contents: [
            {
              Key: "Test Artist/Test Album/1__Test Track.mp3",
              LastModified: new Date(),
            },
          ],
          IsTruncated: false,
        });
      }
      if (name === "GetObjectCommand") {
        getObjectCalls++;
        const input = (command as { input: { Key: string } }).input;
        if (input.Key === "Test Artist/Test Album/cover.jpeg") {
          const stream = new Response(jpegBytes).body!;
          return Promise.resolve({ Body: stream });
        }
      }
      return Promise.resolve({});
    });
    try {
      await getUploadedFiles(true);
      const params = {
        artistId: "Test Artist",
        albumId: "Test Album",
      };
      const first = await handleAlbumCover(
        new Request("http://localhost/cover"),
        params,
      );
      assertEquals(first.status, 200);
      const second = await handleAlbumCover(
        new Request("http://localhost/cover"),
        params,
      );
      assertEquals(second.status, 200);
      assertEquals(getObjectCalls, 1);
      assertEquals(
        new Uint8Array(await second.arrayBuffer()),
        jpegBytes,
      );
    } finally {
      setSendBehavior(null);
      await getUploadedFiles(true);
    }
  },
);

Deno.test("Album cover handler returns 404 when album is not in file index", async () => {
  setupStorageEnv();
  clearAlbumCoverHandlerCache();
  setSendBehavior((command: unknown) => {
    const name = (command as { constructor: { name: string } }).constructor
      ?.name;
    if (name === "ListObjectsV2Command") {
      return Promise.resolve({ Contents: [], IsTruncated: false });
    }
    return Promise.resolve({});
  });
  try {
    await getUploadedFiles(true);
    const response = await handleAlbumCover(
      new Request("http://localhost/cover"),
      {
        artistId: "Nobody",
        albumId: "Nothing",
      },
    );
    assertEquals(response.status, 404);
    assertEquals(await response.text(), "Album not found");
  } finally {
    setSendBehavior(null);
    await getUploadedFiles(true);
  }
});

Deno.test(
  "Album cover handler falls back to ID3 when S3 cover.jpeg is missing",
  async () => {
    setupStorageEnv();
    clearAlbumCoverHandlerCache();
    try {
      setGetID3TagsReturn({
        artist: "Test Artist",
        album: "Test Album",
        title: "Track",
        trackNumber: 1,
        image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      });
      setSendBehavior((command: unknown) => {
        const name = (command as { constructor: { name: string } }).constructor
          ?.name;
        if (name === "ListObjectsV2Command") {
          return Promise.resolve({
            Contents: [
              {
                Key: "Test Artist/Test Album/1__T.mp3",
                LastModified: new Date(),
              },
            ],
            IsTruncated: false,
          });
        }
        if (name === "GetObjectCommand") {
          const key = (command as { input: { Key: string } }).input.Key;
          if (key === "Test Artist/Test Album/cover.jpeg") {
            return Promise.reject(new Error("NoSuchKey"));
          }
          const stream = new Response(new Uint8Array([1, 2, 3])).body!;
          return Promise.resolve({ Body: stream });
        }
        return Promise.resolve({});
      });
      await getUploadedFiles(true);

      const req = new Request(
        "http://localhost:8000/artists/Test%20Artist/albums/Test%20Album/cover",
      );
      const response = await handleAlbumCover(req, {
        artistId: "Test Artist",
        albumId: "Test Album",
      });

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("Content-Type"), "image/jpeg");
    } finally {
      setSendBehavior(null);
      await getUploadedFiles(true);
    }
  },
);

const defaultId3Mock = {
  artist: "Test Artist",
  album: "Test Album",
  title: "Test Song",
  trackNumber: 1,
  image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
} as const;

Deno.test(
  "Album cover handler returns 404 when ID3 has no embedded image and no S3 cover",
  async () => {
    setupStorageEnv();
    clearAlbumCoverHandlerCache();
    try {
      setGetID3TagsReturn({
        artist: "Test Artist",
        album: "Test Album",
        title: "Track",
        trackNumber: 1,
      });
      setSendBehavior((command: unknown) => {
        const name = (command as { constructor: { name: string } }).constructor
          ?.name;
        if (name === "ListObjectsV2Command") {
          return Promise.resolve({
            Contents: [
              {
                Key: "Test Artist/Test Album/1__T.mp3",
                LastModified: new Date(),
              },
            ],
            IsTruncated: false,
          });
        }
        if (name === "GetObjectCommand") {
          const key = (command as { input: { Key: string } }).input.Key;
          if (key === "Test Artist/Test Album/cover.jpeg") {
            return Promise.reject(new Error("NoSuchKey"));
          }
          const stream = new Response(new Uint8Array([1, 2, 3])).body!;
          return Promise.resolve({ Body: stream });
        }
        return Promise.resolve({});
      });
      await getUploadedFiles(true);
      const response = await handleAlbumCover(
        new Request("http://localhost/cover"),
        {
          artistId: "Test Artist",
          albumId: "Test Album",
        },
      );
      assertEquals(response.status, 404);
      assertEquals(await response.text(), "No cover art in album tracks");
    } finally {
      setSendBehavior(null);
      setGetID3TagsReturn({ ...defaultId3Mock });
      await getUploadedFiles(true);
    }
  },
);

Deno.test(
  "Album cover handler returns 500 when ID3 image data URL cannot be decoded",
  async () => {
    setupStorageEnv();
    clearAlbumCoverHandlerCache();
    try {
      setGetID3TagsReturn({
        artist: "Test Artist",
        album: "Test Album",
        title: "Track",
        trackNumber: 1,
        image: "data:image/jpeg;base64,!!",
      });
      setSendBehavior((command: unknown) => {
        const name = (command as { constructor: { name: string } }).constructor
          ?.name;
        if (name === "ListObjectsV2Command") {
          return Promise.resolve({
            Contents: [
              {
                Key: "Test Artist/Test Album/1__T.mp3",
                LastModified: new Date(),
              },
            ],
            IsTruncated: false,
          });
        }
        if (name === "GetObjectCommand") {
          const key = (command as { input: { Key: string } }).input.Key;
          if (key === "Test Artist/Test Album/cover.jpeg") {
            return Promise.reject(new Error("NoSuchKey"));
          }
          const stream = new Response(new Uint8Array([1, 2, 3])).body!;
          return Promise.resolve({ Body: stream });
        }
        return Promise.resolve({});
      });
      await getUploadedFiles(true);
      const response = await handleAlbumCover(
        new Request("http://localhost/cover"),
        {
          artistId: "Test Artist",
          albumId: "Test Album",
        },
      );
      assertEquals(response.status, 500);
      assertEquals(await response.text(), "Invalid cover image data");
    } finally {
      setSendBehavior(null);
      setGetID3TagsReturn({ ...defaultId3Mock });
      await getUploadedFiles(true);
    }
  },
);
