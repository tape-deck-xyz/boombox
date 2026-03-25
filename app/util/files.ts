/** @file Utility methods for working with the Files object */

import { fromUrl } from "id3js";
import { parseTrackMetadataFromUrlText } from "./track-metadata.ts";

export type Track = {
  url: string;
  title: string;
  trackNum: number;
  lastModified: number | null;
};

export type Album = {
  id: string;
  title: string;
  /**
   * Public HTTPS URL for the album’s `cover.jpeg` object in S3, or `null` when
   * absent or not verified at cache regen. Single source of truth for cover art
   * location; do not derive client-side from path patterns.
   */
  coverArtUrl: string | null;
  tracks: Array<Track>;
};

export type Files = {
  [artist: string]: {
    [album: string]: Album;
  };
};

// Artists ////////////////////////////////////////////////////////////////////

/** Get artist data from files object */
export const getArtist = (files: Files, artistId: string) => {
  return files[artistId];
};

// Tracks /////////////////////////////////////////////////////////////////////

/** Sort tracks by track number */
export const sortTracksByTrackNumber = (a: Track, b: Track) => {
  if (a.trackNum < b.trackNum) {
    return -1;
  } else if (a.trackNum > b.trackNum) {
    return 1;
  }

  return 0;
};

/** Given a track's URL, pull data from it to determine the track's artist, album, and number */
export const getParentDataFromTrackUrl = (trackUrl: string | null) => {
  if (!trackUrl) {
    return {
      artistName: null,
      albumName: null,
      trackName: null,
      trackNumber: null,
    };
  }

  const parsedMetadata = parseTrackMetadataFromUrlText(trackUrl);
  const artistName = parsedMetadata.artist;
  const albumName = parsedMetadata.album;
  const trackName = parsedMetadata.title;
  const trackNumber = parsedMetadata.trackNumberText;

  return {
    artistName,
    albumName,
    trackName,
    trackNumber,
  };
};

// Albums /////////////////////////////////////////////////////////////////////

/**
 * Given an albumID, find it in a files object
 * @param files File object
 * @param albumId Album ID in the format "artistID/albumID"
 * @returns Value of album (array of tracks)
 */
export const getAlbum = (files: Files, albumId: string): Album => {
  const albumIdsObj: {
    [albumId: string]: Album;
  } = Object.keys(files)
    .map((artist) => {
      return Object.entries(files[artist]).reduce(
        (acc, cur) => ({ ...acc, [`${artist}/${cur[0]}`]: cur[1] }),
        {},
      );
    })
    .reduce((acc, cur) => ({ ...acc, ...cur }), {});

  return albumIdsObj[albumId];
};

/** Album art cache to avoid repetitve fetches */
const albumArtCache = new Map<string, Promise<string | null>>();
/** Track blob URLs for cleanup */
const blobUrlCache = new Map<string, string>();

/** Fetch album art. Cached. Returns a blob URL. Client-side only. */
export const getAlbumArtAsBlobUrl = (files: Files, albumId: string) => {
  if (!albumArtCache.has(albumId)) {
    const album = getAlbum(files, albumId);

    if (!album) {
      return Promise.resolve(null);
    }
    const artFetch = fromUrl(album.tracks[0].url).then((tags) => {
      if (Array.isArray(tags?.images)) {
        const arrayBuffer = tags.images[0].data;
        const blob = new Blob([arrayBuffer]);
        const srcBlob = URL.createObjectURL(blob);

        // Revoke previous URL if it exists (cache replacement)
        const previousUrl = blobUrlCache.get(albumId);
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }

        // Track the new blob URL for cleanup
        blobUrlCache.set(albumId, srcBlob);

        return srcBlob;
      } else {
        return null;
      }
    });

    albumArtCache.set(albumId, artFetch);
  }

  return albumArtCache.get(albumId)!;
};

/** Get album art as a data URL. Not cached */
export const getAlbumArtAsDataUrl = async (
  files: Files,
  albumId: string,
): Promise<string | null> => {
  const album = getAlbum(files, albumId);
  if (!album) return null;

  const tags = await fromUrl(album.tracks[0].url);
  if (Array.isArray(tags?.images)) {
    const arrayBuffer = tags.images[0].data;
    const mimeType = tags.images[0].mime || "image/jpeg";

    // Convert to base64 - use efficient chunking to avoid stack overflow
    const uint8Array = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000; // 32KB chunks
    const chunks: string[] = [];

    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(
        i,
        Math.min(i + chunkSize, uint8Array.length),
      );
      // Build string for this chunk without spreading
      let chunkStr = "";
      for (let j = 0; j < chunk.length; j++) {
        chunkStr += String.fromCharCode(chunk[j]);
      }
      chunks.push(chunkStr);
    }

    const binaryString = chunks.join("");
    const base64 = btoa(binaryString);
    return `data:${mimeType};base64,${base64}`;
  }
  return null;
};

/** Cleanup function to revoke ID3-derived blob URLs (useful for cache invalidation) */
export const revokeAlbumArtBlobCache = (albumId: string) => {
  const url = blobUrlCache.get(albumId);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlCache.delete(albumId);
    albumArtCache.delete(albumId);
  }
};

/** Given files and a track URL, get the following tracks on the album */
export const getRemainingAlbumTracks = (files: Files, trackUrl: string) => {
  const { artistName, albumName } = getParentDataFromTrackUrl(trackUrl);
  const album = getAlbum(files, `${artistName}/${albumName}`);
  if (album) {
    const currentTrackIndex = album.tracks.findIndex((t) => t.url === trackUrl);
    const remainingAlbumTracks = album.tracks.slice(currentTrackIndex + 1);
    return remainingAlbumTracks;
  }

  return [];
};

/** Get all Album IDs */
const getAlbumIds = (files: Files) =>
  Object.values(files).flatMap((albums) =>
    Object.values(albums).map((album) => album.id)
  );

/** Get most recently uploaded albums */
export const getAlbumIdsByRecent = (files: Files): Album[] => {
  const albums = getAlbumIds(files).map((albumId) => ({
    albumId,
    ...getAlbum(files, albumId),
  }));

  const sortTracksByMostRecentlyModified = (a: Track, b: Track) => {
    if (a.lastModified && b.lastModified) {
      return (
        new Date(b.lastModified).valueOf() - new Date(a.lastModified).valueOf()
      );
    }
    return 0;
  };

  const sortAlbumsByMostRecentlyModifiedTracks = (a: Album, b: Album) => {
    const firstSortedATrack = [...a.tracks].sort(
      sortTracksByMostRecentlyModified,
    )[0];
    const firstSortedBTrack = [...b.tracks].sort(
      sortTracksByMostRecentlyModified,
    )[0];

    if (firstSortedATrack.lastModified && firstSortedBTrack.lastModified) {
      return (
        new Date(firstSortedBTrack.lastModified).valueOf() -
        new Date(firstSortedATrack.lastModified).valueOf()
      );
    }

    return 0;
  };

  return albums.sort(sortAlbumsByMostRecentlyModifiedTracks);
};

// Searching //////////////////////////////////////////////////////////////////

type SearchResult = { id: string; title: string; localUrl: string };

interface TrackSearchResult extends SearchResult {
  url: string;
}

export type SearchResults = {
  artists: SearchResult[];
  albums: SearchResult[];
  tracks: TrackSearchResult[];
};

/** Files artists, albums, and songs that match `searchStr` */
export const search = (files: Files, searchStr: string): SearchResults => {
  const results: SearchResults = {
    artists: [],
    albums: [],
    tracks: [],
  };

  Object.entries(files).forEach(([artist, albumsObj]) => {
    if (artist.toLocaleLowerCase().includes(searchStr)) {
      results.artists.push({
        id: artist,
        title: artist,
        localUrl: `/artists/${encodeURIComponent(artist)}`,
      });
    }

    Object.entries(albumsObj).forEach(([album, albumObj]) => {
      if (album.toLocaleLowerCase().includes(searchStr)) {
        results.albums.push({
          id: albumObj.id,
          title: album,
          localUrl: `/artists/${encodeURIComponent(artist)}/albums/${
            encodeURIComponent(album)
          }`,
        });
      }

      albumObj.tracks.forEach((t) => {
        if (t.title.toLocaleLowerCase().includes(searchStr)) {
          results.tracks.push({
            id: t.url,
            title: t.title,
            localUrl: `/artists/${encodeURIComponent(artist)}/albums/${
              encodeURIComponent(album)
            }`,
            url: t.url,
          });
        }
      });
    });
  });

  return results;
};
