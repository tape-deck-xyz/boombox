/** @file Tests for create-release-pr script. */

import { assertEquals, assertRejects } from "@std/assert";
import { parseArgs } from "./create-release-pr.ts";

Deno.test("parseArgs returns options when all args and token provided", () => {
  const args = [
    "--owner",
    "tape-deck-xyz",
    "--repo",
    "boombox",
    "--head",
    "release/v1.2.3",
    "--base",
    "main",
    "--title",
    "chore(release): v1.2.3 [skip ci]",
    "--body",
    "Release v1.2.3",
  ];
  const env = {
    get: (k: string) => k === "GITHUB_TOKEN" ? "secret" : undefined,
  };

  const opts = parseArgs(args, env);

  assertEquals(opts.owner, "tape-deck-xyz");
  assertEquals(opts.repo, "boombox");
  assertEquals(opts.head, "release/v1.2.3");
  assertEquals(opts.base, "main");
  assertEquals(opts.title, "chore(release): v1.2.3 [skip ci]");
  assertEquals(opts.body, "Release v1.2.3");
  assertEquals(opts.token, "secret");
});

Deno.test("parseArgs uses GH_TOKEN when GITHUB_TOKEN not set", () => {
  const args = [
    "--owner",
    "o",
    "--repo",
    "r",
    "--head",
    "h",
    "--base",
    "b",
    "--title",
    "t",
    "--body",
    "b",
  ];
  const env = {
    get: (k: string) => k === "GH_TOKEN" ? "gh-secret" : undefined,
  };

  const opts = parseArgs(args, env);

  assertEquals(opts.token, "gh-secret");
});

Deno.test("parseArgs throws when token missing", () => {
  const args = [
    "--owner",
    "o",
    "--repo",
    "r",
    "--head",
    "h",
    "--base",
    "b",
    "--title",
    "t",
    "--body",
    "b",
  ];
  const env = { get: () => undefined };

  assertRejects(
    () => Promise.resolve().then(() => parseArgs(args, env)),
    Error,
    "GITHUB_TOKEN or GH_TOKEN",
  );
});

Deno.test("parseArgs throws when required arg missing", () => {
  const args = ["--owner", "o"]; // missing --repo, --head, etc.
  const env = { get: (k: string) => k === "GITHUB_TOKEN" ? "x" : undefined };

  assertRejects(
    () => Promise.resolve().then(() => parseArgs(args, env)),
    Error,
    "Missing required argument",
  );
});
