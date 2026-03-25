/** @file Tests for app/util/files.ts (runs in tests/ for coverage merge) */
import { assertEquals } from "@std/assert";
import { type Files, getArtist } from "../../app/util/files.ts";

Deno.test("getArtist returns artist data", () => {
  const files: Files = {
    "Test Artist": {
      "Test Album": {
        id: "Test Artist/Test Album",
        title: "Test Album",
        coverArtUrl: null,
        tracks: [],
      },
    },
  };

  const artist = getArtist(files, "Test Artist");
  assertEquals(artist, files["Test Artist"]);
});
