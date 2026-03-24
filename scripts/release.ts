/** @file Conventional commit based semantic release helpers.
 *
 * CLI: default run writes `deno.json` / changelog; `--dry-run` prints the next
 * version only; `--tag-disposition <tag>` prints `absent`, `merged`, or `orphan`
 * for CI (see `scripts/circleci-release.sh`).
 */

export type ReleaseBump = "none" | "patch" | "minor" | "major";

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CONVENTIONAL_COMMIT_HEADER_PATTERN = /^([a-z]+)(?:\([^)]+\))?(!)?:\s+/;
const PATCH_RELEASE_TYPES = new Set(["fix", "perf", "revert"]);

const BUMP_PRIORITY: Record<ReleaseBump, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

interface DenoConfig {
  version?: string;
  [key: string]: unknown;
}

export interface ReleaseResult {
  currentVersion: string;
  nextVersion: string;
  bump: Exclude<ReleaseBump, "none">;
  previousTag: string | null;
  commitMessages: string[];
}

function getCommitHeader(message: string): string {
  return message.split("\n", 1)[0]?.trim() ?? "";
}

function hasBreakingChange(message: string): boolean {
  return /(^|\n)BREAKING[\s-]CHANGE:\s+/m.test(message);
}

function isReleaseCommitHeader(header: string): boolean {
  return /^chore\(release\):\s*v?\d+\.\d+\.\d+/i.test(header);
}

export function getCommitBump(message: string): ReleaseBump {
  const header = getCommitHeader(message);

  if (!header || isReleaseCommitHeader(header)) {
    return "none";
  }

  const conventionalMatch = header.match(CONVENTIONAL_COMMIT_HEADER_PATTERN);
  if (!conventionalMatch) {
    return hasBreakingChange(message) ? "major" : "none";
  }

  const [, type, isBreaking] = conventionalMatch;
  if (isBreaking || hasBreakingChange(message)) {
    return "major";
  }

  if (type === "feat") {
    return "minor";
  }

  if (PATCH_RELEASE_TYPES.has(type)) {
    return "patch";
  }

  return "none";
}

export function determineVersionBump(commitMessages: string[]): ReleaseBump {
  let highestBump: ReleaseBump = "none";

  for (const message of commitMessages) {
    const bump = getCommitBump(message);
    if (BUMP_PRIORITY[bump] > BUMP_PRIORITY[highestBump]) {
      highestBump = bump;
    }
    if (highestBump === "major") {
      return highestBump;
    }
  }

  return highestBump;
}

export function incrementSemver(
  currentVersion: string,
  bump: Exclude<ReleaseBump, "none">,
): string {
  const match = currentVersion.match(SEMVER_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid semantic version "${currentVersion}". Expected <major>.<minor>.<patch>.`,
    );
  }

  const [, majorRaw, minorRaw, patchRaw] = match;
  let major = Number(majorRaw);
  let minor = Number(minorRaw);
  let patch = Number(patchRaw);

  switch (bump) {
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case "minor":
      minor += 1;
      patch = 0;
      break;
    case "patch":
      patch += 1;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

/** Parsed conventional commit for release notes. */
interface ParsedCommit {
  scope: string | null;
  subject: string;
  breaking: boolean;
}

function parseCommitForNotes(message: string): ParsedCommit | null {
  const header = getCommitHeader(message);

  if (!header || isReleaseCommitHeader(header)) {
    return null;
  }

  const match = header.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.*)$/);
  if (!match) {
    return null;
  }

  const [, , scope, isBreaking, subject] = match;
  return {
    scope: scope ?? null,
    subject: subject.trim(),
    breaking: isBreaking === "!" || hasBreakingChange(message),
  };
}

/**
 * Format commit messages into release notes markdown.
 * Groups by scope (alphabetically), with breaking changes first.
 * Excludes release commits. Includes all conventional commit types.
 */
export function formatReleaseNotes(commitMessages: string[]): string {
  const breaking: string[] = [];
  const byScope = new Map<string, string[]>();
  const general: string[] = [];

  for (const message of commitMessages) {
    const parsed = parseCommitForNotes(message);
    if (!parsed) continue;

    if (parsed.breaking) {
      breaking.push(parsed.subject);
    } else if (parsed.scope) {
      const list = byScope.get(parsed.scope) ?? [];
      list.push(parsed.subject);
      byScope.set(parsed.scope, list);
    } else {
      general.push(parsed.subject);
    }
  }

  const sections: string[] = [];

  if (breaking.length > 0) {
    sections.push("### Breaking changes");
    for (const s of breaking) {
      sections.push(`* ${s}`);
    }
    sections.push("");
  }

  const scopes = [...byScope.keys()].sort();
  for (const scope of scopes) {
    sections.push(`### ${scope}`);
    for (const s of byScope.get(scope)!) {
      sections.push(`* ${s}`);
    }
    sections.push("");
  }

  if (general.length > 0) {
    sections.push("### General");
    for (const s of general) {
      sections.push(`* ${s}`);
    }
  }

  return sections.join("\n").trimEnd();
}

const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
`;

/**
 * Prepend a new version section to CHANGELOG.md.
 * Creates the file with Keep a Changelog format if it does not exist.
 *
 * @param version - Semantic version (e.g. "1.2.3")
 * @param releaseNotes - Formatted release notes markdown
 * @param changelogPath - Path to CHANGELOG.md (default: CHANGELOG.md in cwd)
 * @param date - ISO date string YYYY-MM-DD (default: today)
 */
export async function prependChangelogSection(
  version: string,
  releaseNotes: string,
  changelogPath = `${Deno.cwd()}/CHANGELOG.md`,
  date = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const section = `## [${version}] - ${date}\n\n${releaseNotes}\n\n`;

  let existing: string;
  try {
    existing = await Deno.readTextFile(changelogPath);
  } catch {
    await Deno.writeTextFile(
      changelogPath,
      CHANGELOG_HEADER + "\n" + section,
    );
    return;
  }

  const unreleasedIndex = existing.indexOf("## [Unreleased]");
  if (unreleasedIndex === -1) {
    await Deno.writeTextFile(changelogPath, existing + "\n" + section);
    return;
  }

  const afterUnreleased = unreleasedIndex + "## [Unreleased]".length;
  const nextSectionIndex = existing.indexOf("\n## [", afterUnreleased);
  const insertAt = nextSectionIndex === -1
    ? existing.length
    : nextSectionIndex + 1; // include \n in before, after starts at ##
  const before = existing.slice(0, insertAt);
  const after = existing.slice(insertAt);

  await Deno.writeTextFile(changelogPath, before + section + after);
}

export function parseGitLogMessages(gitLogOutput: string): string[] {
  return gitLogOutput
    .split("\x1e")
    .map((message) => message.trim())
    .filter(Boolean);
}

function isSemverTag(tag: string): boolean {
  return SEMVER_TAG_PATTERN.test(tag.trim());
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `git ${args.join(" ")} failed with code ${output.code}: ${stderr}`,
    );
  }

  return new TextDecoder().decode(output.stdout);
}

async function gitCommandSucceeded(
  args: string[],
  cwd: string,
): Promise<boolean> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "null",
  }).output();
  return output.success;
}

/** Result of classifying a release tag relative to the current `HEAD`. */
export type ReleaseTagDisposition =
  | { status: "absent" }
  | { status: "merged"; tagCommit: string }
  | { status: "orphan"; tagCommit: string };

/**
 * Whether `refs/tags/<tagName>` exists, and if so whether it points to a commit
 * already on the current branch (`HEAD`).
 *
 * Used by CI to avoid treating an orphan tag (on `release/x.y.z` only) as a
 * completed release for `main`.
 */
export async function getReleaseTagDisposition(
  tagName: string,
  repositoryPath = Deno.cwd(),
): Promise<ReleaseTagDisposition> {
  const ref = `refs/tags/${tagName}`;
  const exists = await gitCommandSucceeded(
    ["rev-parse", "-q", "--verify", ref],
    repositoryPath,
  );
  if (!exists) {
    return { status: "absent" };
  }

  const tagCommit =
    (await runGit(["rev-parse", `${tagName}^{}`], repositoryPath))
      .trim();
  const merged = await gitCommandSucceeded(
    ["merge-base", "--is-ancestor", tagCommit, "HEAD"],
    repositoryPath,
  );

  if (merged) {
    return { status: "merged", tagCommit };
  }

  return { status: "orphan", tagCommit };
}

async function getLatestSemverTag(cwd: string): Promise<string | null> {
  const output = await runGit(
    ["tag", "--merged", "HEAD", "--sort=-v:refname"],
    cwd,
  );
  const tag = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => isSemverTag(line));

  return tag ?? null;
}

async function getCommitMessagesSinceTag(
  latestTag: string | null,
  cwd: string,
): Promise<string[]> {
  const revisionRange = latestTag ? `${latestTag}..HEAD` : "HEAD";
  const output = await runGit(["log", "--format=%B%x1e", revisionRange], cwd);

  return parseGitLogMessages(output);
}

export async function readDenoVersion(configPath: string): Promise<string> {
  const text = await Deno.readTextFile(configPath);
  const config = JSON.parse(text) as DenoConfig;

  if (!config.version || typeof config.version !== "string") {
    throw new Error(`Missing "version" field in ${configPath}.`);
  }

  if (!SEMVER_PATTERN.test(config.version)) {
    throw new Error(
      `Invalid "version" field in ${configPath}: "${config.version}".`,
    );
  }

  return config.version;
}

export async function writeDenoVersion(
  configPath: string,
  nextVersion: string,
): Promise<void> {
  const text = await Deno.readTextFile(configPath);
  const config = JSON.parse(text) as DenoConfig;
  config.version = nextVersion;

  await Deno.writeTextFile(
    `${configPath}`,
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

export async function computeRelease(
  repositoryPath = Deno.cwd(),
  denoConfigPath = `${Deno.cwd()}/deno.json`,
): Promise<ReleaseResult | null> {
  const currentVersion = await readDenoVersion(denoConfigPath);
  const previousTag = await getLatestSemverTag(repositoryPath);
  const commitMessages = await getCommitMessagesSinceTag(
    previousTag,
    repositoryPath,
  );
  const bump = determineVersionBump(commitMessages);

  if (bump === "none") {
    return null;
  }

  const nextVersion = incrementSemver(currentVersion, bump);
  return {
    bump,
    commitMessages,
    currentVersion,
    nextVersion,
    previousTag,
  };
}

if (import.meta.main) {
  const tagDispIdx = Deno.args.indexOf("--tag-disposition");
  if (tagDispIdx !== -1) {
    const tagName = Deno.args[tagDispIdx + 1];
    if (!tagName) {
      console.error(
        'Missing tag name after --tag-disposition (e.g. "v1.2.3").',
      );
      Deno.exit(1);
    }
    const d = await getReleaseTagDisposition(tagName);
    console.log(d.status);
    Deno.exit(0);
  }

  const dryRun = Deno.args.includes("--dry-run");
  const release = await computeRelease();

  if (!release) {
    Deno.exit(0);
  }

  const releaseNotes = formatReleaseNotes(release.commitMessages);

  if (dryRun) {
    console.log(release.nextVersion);
    console.log("\n--- Release notes preview ---\n");
    console.log(releaseNotes);
    Deno.exit(0);
  }

  const releaseNotesPath = `${Deno.cwd()}/release-notes.md`;
  await Deno.writeTextFile(releaseNotesPath, releaseNotes);
  await prependChangelogSection(release.nextVersion, releaseNotes);
  await writeDenoVersion(`${Deno.cwd()}/deno.json`, release.nextVersion);

  console.log(release.nextVersion);
}
