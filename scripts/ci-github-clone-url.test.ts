/** @file Contract for GitHub org/repo parsing in CircleCI bash (see .circleci/config.yml
 * "Prepare git for release" and resolve_github_owner_repo in scripts/circleci-release.sh).
 */

import { assertEquals } from "@std/assert";

/** Mirrors bash logic: strip .git, then git@github.com: or last github.com/ segment. */
export function parseGithubOwnerRepoFromCloneUrl(url: string): {
  owner: string;
  repo: string;
} | null {
  let u = url.replace(/\.git$/i, "");
  let slug: string;
  if (u.startsWith("git@github.com:")) {
    slug = u.slice("git@github.com:".length);
  } else {
    const needle = "github.com/";
    const idx = u.lastIndexOf(needle);
    if (idx === -1) return null;
    slug = u.slice(idx + needle.length);
  }
  const slash = slug.indexOf("/");
  if (slash === -1) return null;
  const owner = slug.slice(0, slash);
  const repo = slug.slice(slash + 1).split("/")[0] ?? "";
  if (!owner || !repo) return null;
  return { owner, repo };
}

Deno.test("parseGithubOwnerRepoFromCloneUrl parses HTTPS and git@ URLs", () => {
  assertEquals(
    parseGithubOwnerRepoFromCloneUrl(
      "https://github.com/tape-deck-xyz/boombox.git",
    ),
    { owner: "tape-deck-xyz", repo: "boombox" },
  );
  assertEquals(
    parseGithubOwnerRepoFromCloneUrl(
      "git@github.com:tape-deck-xyz/boombox.git",
    ),
    { owner: "tape-deck-xyz", repo: "boombox" },
  );
  assertEquals(
    parseGithubOwnerRepoFromCloneUrl(
      "https://x-access-token:secret@github.com/tape-deck-xyz/boombox",
    ),
    { owner: "tape-deck-xyz", repo: "boombox" },
  );
});

Deno.test("parseGithubOwnerRepoFromCloneUrl returns null for non-GitHub URLs", () => {
  assertEquals(
    parseGithubOwnerRepoFromCloneUrl("https://gitlab.com/a/b.git"),
    null,
  );
});
