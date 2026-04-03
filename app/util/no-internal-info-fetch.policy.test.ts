/** @file Policy: first-party app code must not fetch the /info URL except admin ?refresh=1.
 *
 * Aggregators use `GET /info`; the bundled client reads the embedded catalog (see
 * `docs/library-catalog-and-info.md`).
 *
 * Allowed paths contain refresh or are listed in {@link ALLOWED_PATH_SUBSTRINGS}.
 */
import { assert } from "@std/assert";

const ALLOWED_PATH_SUBSTRINGS = [
  "/RefreshCache/",
  "no-internal-info-fetch.policy.test.ts",
  "/e2e/",
];

function isAllowedPath(path: string): boolean {
  return ALLOWED_PATH_SUBSTRINGS.some((s) => path.includes(s));
}

async function* walkTsFiles(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walkTsFiles(p);
    else if (e.name.endsWith(".ts")) yield p;
  }
}

function isDocumentationOrCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/**") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.endsWith("*/")
  );
}

function lineReferencesInfoFetchWithoutRefresh(line: string): boolean {
  const trimmed = line.trim();
  if (isDocumentationOrCommentLine(trimmed)) return false;
  const hasFetch = trimmed.includes("fetch(");
  const hasInfoPath = trimmed.includes('"/info"') ||
    trimmed.includes("'/info'") ||
    trimmed.includes("`/info`");
  if (!hasFetch || !hasInfoPath) return false;
  return !trimmed.includes("refresh=1");
}

Deno.test("policy: app/ must not fetch /info except ?refresh=1 (see docs/library-catalog-and-info.md)", async () => {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const violations: string[] = [];

  for await (const path of walkTsFiles(root)) {
    const rel = path.startsWith(root)
      ? `app/${path.slice(root.length + 1)}`
      : path;
    if (isAllowedPath(rel)) continue;
    const text = await Deno.readTextFile(path);
    let lineNum = 0;
    for (const line of text.split("\n")) {
      lineNum++;
      if (lineReferencesInfoFetchWithoutRefresh(line)) {
        violations.push(`${rel}:${lineNum}: ${line.trim()}`);
      }
    }
  }

  assert(
    violations.length === 0,
    `Disallowed /info fetch in app bundle inputs:\n${violations.join("\n")}`,
  );
});
