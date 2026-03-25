/** @file Tests for album row with title HTML function.
 *
 * Verifies that albumRowWithTitleHtml delegates to albumTileHtml and
 * horizontalRowWithTitleHtml to produce a section with title and album tiles.
 */

import { assertEquals, assertExists } from "@std/assert";
import { parseHtmlFragment } from "../test.utils.ts";
import type { Files } from "../../util/files.ts";
import albumRowWithTitleHtml from "./album-row-with-title-html.ts";

function makeFiles(artistId: string, albumId: string): Files {
  const id = `${artistId}/${albumId}`;
  return {
    [artistId]: {
      [albumId]: {
        id,
        title: albumId,
        coverArtUrl: null,
        tracks: [
          {
            url:
              `https://bucket.s3.region.amazonaws.com/${artistId}/${albumId}/1__Track.mp3`,
            title: "Track",
            trackNum: 1,
            lastModified: null,
          },
        ],
      },
    },
  };
}

Deno.test("albumRowWithTitleHtml returns section with title and nav-links", () => {
  const files = makeFiles("Artist", "Album");
  const html = albumRowWithTitleHtml({
    albumIds: [{ id: "Artist/Album" }],
    files,
    title: "Latest",
  });

  const document = parseHtmlFragment(html);
  const section = document.querySelector("section");
  const titleP = document.querySelector("section > p");
  const navLinks = document.querySelectorAll("nav-link");

  assertExists(section);
  assertExists(titleP);
  assertEquals(titleP.textContent?.trim(), "Latest");
  assertEquals(navLinks.length, 1);
  assertEquals(
    navLinks[0].getAttribute("href"),
    "/artists/Artist/albums/Album",
  );
});
