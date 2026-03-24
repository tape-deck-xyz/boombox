/** @file Tests for conventional commit release helpers. */

import { assertEquals, assertRejects } from "@std/assert";
import {
  determineVersionBump,
  formatReleaseNotes,
  getCommitBump,
  getReleaseTagDisposition,
  incrementSemver,
  parseGitLogMessages,
  prependChangelogSection,
} from "./release.ts";

async function git(args: string[], cwd: string): Promise<void> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const err = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${err}`);
  }
}

Deno.test("getReleaseTagDisposition classifies absent merged and orphan tags", async () => {
  const absentDir = await Deno.makeTempDir();
  try {
    await git(["init", "-b", "main"], absentDir);
    await git(["config", "user.email", "t@e.st"], absentDir);
    await git(["config", "user.name", "t"], absentDir);
    await Deno.writeTextFile(`${absentDir}/f`, "a\n");
    await git(["add", "f"], absentDir);
    await git(["commit", "-m", "chore: initial"], absentDir);
    assertEquals(
      (await getReleaseTagDisposition("v1.0.0", absentDir)).status,
      "absent",
    );
  } finally {
    await Deno.remove(absentDir, { recursive: true });
  }

  const mergedDir = await Deno.makeTempDir();
  try {
    await git(["init", "-b", "main"], mergedDir);
    await git(["config", "user.email", "t@e.st"], mergedDir);
    await git(["config", "user.name", "t"], mergedDir);
    await Deno.writeTextFile(`${mergedDir}/f`, "a\n");
    await git(["add", "f"], mergedDir);
    await git(["commit", "-m", "chore: initial"], mergedDir);
    await git(["tag", "v1.0.0"], mergedDir);
    const merged = await getReleaseTagDisposition("v1.0.0", mergedDir);
    assertEquals(merged.status, "merged");
  } finally {
    await Deno.remove(mergedDir, { recursive: true });
  }

  const orphanDir = await Deno.makeTempDir();
  try {
    await git(["init", "-b", "main"], orphanDir);
    await git(["config", "user.email", "t@e.st"], orphanDir);
    await git(["config", "user.name", "t"], orphanDir);
    await Deno.writeTextFile(`${orphanDir}/f`, "a\n");
    await git(["add", "f"], orphanDir);
    await git(["commit", "-m", "chore: on main"], orphanDir);
    await git(["checkout", "-b", "release"], orphanDir);
    await Deno.writeTextFile(`${orphanDir}/f`, "a\nb\n");
    await git(["add", "f"], orphanDir);
    await git(["commit", "-m", "chore(release): v1.0.0"], orphanDir);
    await git(["tag", "v1.0.0"], orphanDir);
    await git(["checkout", "main"], orphanDir);
    assertEquals(
      (await getReleaseTagDisposition("v1.0.0", orphanDir)).status,
      "orphan",
    );
  } finally {
    await Deno.remove(orphanDir, { recursive: true });
  }
});

Deno.test("determineVersionBump returns major for breaking commits", () => {
  const bump = determineVersionBump([
    "fix: patch release",
    "feat(ui): add new album card",
    "feat(player)!: remove deprecated queue format\n\nBREAKING CHANGE: queue payload changed",
  ]);

  assertEquals(bump, "major");
});

Deno.test("determineVersionBump returns minor for feat commits", () => {
  const bump = determineVersionBump([
    "chore: update docs",
    "fix: handle edge case in parser",
    "feat(upload): add drag and drop support",
  ]);

  assertEquals(bump, "minor");
});

Deno.test("determineVersionBump returns patch for fix and perf commits", () => {
  const bump = determineVersionBump([
    "docs: improve readme formatting",
    "perf(player): cache playlist lookup",
    "fix(api): guard missing album id",
  ]);

  assertEquals(bump, "patch");
});

Deno.test("determineVersionBump ignores release commits", () => {
  const bump = determineVersionBump([
    "chore(release): v1.2.3",
    "docs: update changelog",
  ]);

  assertEquals(bump, "none");
});

Deno.test("incrementSemver applies patch, minor, and major bumps", () => {
  assertEquals(incrementSemver("1.2.3", "patch"), "1.2.4");
  assertEquals(incrementSemver("1.2.3", "minor"), "1.3.0");
  assertEquals(incrementSemver("1.2.3", "major"), "2.0.0");
});

Deno.test("incrementSemver throws for invalid version format", async () => {
  await assertRejects(
    () => Promise.resolve().then(() => incrementSemver("invalid", "patch")),
    Error,
    "Invalid semantic version",
  );
});

Deno.test("parseGitLogMessages splits NUL-separated git messages", () => {
  const messages = parseGitLogMessages(
    "feat: add queue support\x1e\nfix: prevent null pointer\x1e\n",
  );

  assertEquals(messages, [
    "feat: add queue support",
    "fix: prevent null pointer",
  ]);
});

Deno.test("getCommitBump detects breaking change footer", () => {
  const bump = getCommitBump(
    "chore: migrate transport\n\nBREAKING CHANGE: websocket payload changed",
  );

  assertEquals(bump, "major");
});

Deno.test("formatReleaseNotes groups commits by scope alphabetically", () => {
  const notes = formatReleaseNotes([
    "feat(playbar): show album artwork",
    "feat(upload): add drag and drop support",
    "fix(api): guard missing album id",
  ]);

  assertEquals(
    notes,
    `### api
* guard missing album id

### playbar
* show album artwork

### upload
* add drag and drop support`,
  );
});

Deno.test("formatReleaseNotes puts breaking changes in dedicated section first", () => {
  const notes = formatReleaseNotes([
    "feat(upload): add feature",
    "feat(player)!: remove deprecated queue format",
    "fix(api): guard missing id",
  ]);

  assertEquals(
    notes,
    `### Breaking changes
* remove deprecated queue format

### api
* guard missing id

### upload
* add feature`,
  );
});

Deno.test("formatReleaseNotes puts unscoped commits under General", () => {
  const notes = formatReleaseNotes([
    "docs: improve readme",
    "chore: update dependencies",
  ]);

  assertEquals(
    notes,
    `### General
* improve readme
* update dependencies`,
  );
});

Deno.test("formatReleaseNotes excludes release commits", () => {
  const notes = formatReleaseNotes([
    "feat(upload): add feature",
    "chore(release): v1.2.3",
    "fix(api): guard missing id",
  ]);

  assertEquals(
    notes,
    `### api
* guard missing id

### upload
* add feature`,
  );
});

Deno.test("formatReleaseNotes includes all conventional commit types", () => {
  const notes = formatReleaseNotes([
    "feat(a): new feature",
    "fix(b): bug fix",
    "docs(c): update docs",
    "chore(d): chores",
    "refactor(e): refactor",
    "perf(f): optimize",
    "revert(g): revert change",
  ]);

  assertEquals(
    notes,
    `### a
* new feature

### b
* bug fix

### c
* update docs

### d
* chores

### e
* refactor

### f
* optimize

### g
* revert change`,
  );
});

Deno.test("formatReleaseNotes extracts subject without type or scope prefix", () => {
  const notes = formatReleaseNotes(["feat(upload): add drag and drop support"]);

  assertEquals(notes, `### upload\n* add drag and drop support`);
});

Deno.test("prependChangelogSection creates CHANGELOG when missing", async () => {
  const dir = await Deno.makeTempDir();
  const changelogPath = `${dir}/CHANGELOG.md`;

  await prependChangelogSection(
    "1.0.0",
    "* add feature",
    changelogPath,
    "2025-02-23",
  );

  const content = await Deno.readTextFile(changelogPath);
  assertEquals(
    content,
    `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.0.0] - 2025-02-23

* add feature

`,
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("prependChangelogSection prepends new section when CHANGELOG exists", async () => {
  const dir = await Deno.makeTempDir();
  const changelogPath = `${dir}/CHANGELOG.md`;
  const existing = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.0] - 2025-01-01

* initial release
`;
  await Deno.writeTextFile(changelogPath, existing);

  await prependChangelogSection(
    "0.2.0",
    "* add feature",
    changelogPath,
    "2025-02-23",
  );

  const content = await Deno.readTextFile(changelogPath);
  assertEquals(
    content,
    `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.2.0] - 2025-02-23

* add feature

## [0.1.0] - 2025-01-01

* initial release
`,
  );

  await Deno.remove(dir, { recursive: true });
});
