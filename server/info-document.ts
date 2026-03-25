/** @file JSON Schema validation for the info cache document (cache/info.json, GET /info). */
import Ajv2020Import from "npm:ajv@^8.17.1/dist/2020.js";
import addFormatsImport from "npm:ajv-formats@^3.0.1";

import type { Album, Files } from "../app/util/files.ts";
import type { InfoPayload } from "./info.ts";
import schema from "../schemas/info.schema.json" with { type: "json" };

type AjvInstance = {
  compile: (s: object) => {
    (data: unknown): boolean;
    errors?: object[] | null | undefined;
  };
};

type AjvCtor = new (
  opts?: { allErrors?: boolean; strict?: boolean },
) => AjvInstance;

const Ajv2020 = Ajv2020Import as unknown as AjvCtor;
const addFormats = addFormatsImport as unknown as (a: AjvInstance) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateCompiled = ajv.compile(schema as object);

/**
 * Schema version written to new cache files. Bump when the info document shape changes.
 */
export const INFO_DOCUMENT_SCHEMA_VERSION = 1;

/**
 * Throws if `data` does not match {@link schemas/info.schema.json}.
 */
export function assertValidInfoDocument(
  data: unknown,
): asserts data is InfoPayload {
  if (!validateCompiled(data)) {
    const inst = ajv as unknown as {
      errorsText: (
        e?: object[] | null,
        o?: { separator?: string },
      ) => string;
    };
    const msg = inst.errorsText(validateCompiled.errors ?? null, {
      separator: "\n",
    });
    throw new Error(`Invalid info document:\n${msg}`);
  }
}

/** Normalize legacy cached albums (e.g. missing `coverArtUrl`, old `coverArt` field). */
export function normalizeAlbumFromCache(raw: Record<string, unknown>): Album {
  const legacyCover = raw.coverArtUrl ?? raw.coverArt;
  let coverArtUrl: string | null = null;
  if (typeof legacyCover === "string" && legacyCover.length > 0) {
    coverArtUrl = legacyCover;
  } else if (legacyCover === null || legacyCover === undefined) {
    coverArtUrl = null;
  }

  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];

  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    coverArtUrl,
    tracks: tracks as Album["tracks"],
  };
}

/** Walk `contents` and normalize each album; does not validate full document. */
export function normalizeContentsLegacy(contents: unknown): Files {
  if (typeof contents !== "object" || contents === null) {
    return {};
  }
  const out: Files = {};
  for (const [artist, albums] of Object.entries(contents as Files)) {
    if (typeof albums !== "object" || albums === null) continue;
    out[artist] = {};
    for (const [albumName, album] of Object.entries(albums)) {
      out[artist][albumName] = normalizeAlbumFromCache(
        album as unknown as Record<string, unknown>,
      );
    }
  }
  return out;
}
