/** @file Server-suite coverage for shared utility functions used by handlers. */
import { assertEquals } from "@std/assert";
import {
  createDataUrlFromBytes,
  decodeDataUrl,
} from "../../app/util/data-url.ts";
import {
  type Files,
  getAlbumArtAsBlobUrl,
  getAlbumArtAsDataUrl,
  getAlbumIdsByRecent,
  getParentDataFromTrackUrl,
  getRemainingAlbumTracks,
  revokeAlbumArtBlobCache,
  search,
} from "../../app/util/files.ts";

Deno.test("shared file utilities handle album ordering, search, data URLs, and missing art", async () => {
  const olderTrack = {
    url: "https://cdn.example/Artist%20One/Album%20A/01__Opening.mp3",
    title: "Opening",
    trackNum: 1,
    lastModified: 10,
  };
  const newerTrack = {
    url: "https://cdn.example/Artist%20Two/Album%20B/01__Finale.mp3",
    title: "Finale",
    trackNum: 1,
    lastModified: 20,
  };
  const files: Files = {
    "Artist One": {
      "Album A": {
        id: "Artist One/Album A",
        title: "Album A",
        coverArtUrl: null,
        tracks: [olderTrack],
      },
    },
    "Artist Two": {
      "Album B": {
        id: "Artist Two/Album B",
        title: "Album B",
        coverArtUrl: null,
        tracks: [newerTrack],
      },
    },
  };

  assertEquals(getAlbumIdsByRecent(files).map((album) => album.id), [
    "Artist Two/Album B",
    "Artist One/Album A",
  ]);
  assertEquals(getParentDataFromTrackUrl(olderTrack.url), {
    artistName: "Artist One",
    albumName: "Album A",
    trackName: "Opening.mp3",
    trackNumber: "01",
  });
  assertEquals(getRemainingAlbumTracks(files, olderTrack.url), []);
  assertEquals(search(files, "finale").tracks[0].title, "Finale");

  const dataUrl = createDataUrlFromBytes(
    new Uint8Array([1, 2, 3]),
    "image/png",
  );
  assertEquals(decodeDataUrl(dataUrl)?.body, new Uint8Array([1, 2, 3]));

  assertEquals(await getAlbumArtAsBlobUrl(files, "missing/album"), null);
  assertEquals(await getAlbumArtAsDataUrl(files, "missing/album"), null);
  revokeAlbumArtBlobCache("missing/album");
});
