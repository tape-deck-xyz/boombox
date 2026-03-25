#!/usr/bin/env -S deno run --allow-net --allow-env
/** @file Create a release PR and enable auto-merge via GitHub API.
 *
 * Used by CircleCI release job to open a PR instead of pushing directly to main,
 * satisfying branch protection rules that require changes via pull request.
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/create-release-pr.ts \
 *     --owner tape-deck-xyz --repo boombox \
 *     --head release/v1.2.3 --base main \
 *     --title "chore(release): v1.2.3 [skip ci]" \
 *     --body "Release v1.2.3"
 *
 * Requires GITHUB_TOKEN or GH_TOKEN in environment.
 */

const GITHUB_REST = "https://api.github.com";
/** GraphQL lives on the same host as REST for github.com (not api.graphql.github.com). */
const GITHUB_GRAPHQL = `${GITHUB_REST}/graphql`;

interface CreatePrOptions {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  token: string;
}

interface CreatePrResponse {
  number: number;
  node_id: string;
  html_url: string;
}

/** Create a pull request via GitHub REST API. Returns null if that head already has an open PR. */
async function createPullRequest(
  opts: CreatePrOptions,
): Promise<CreatePrResponse | null> {
  const url = `${GITHUB_REST}/repos/${opts.owner}/${opts.repo}/pulls`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (
      res.status === 422 &&
      /A pull request already exists/i.test(text)
    ) {
      return null;
    }
    throw new Error(
      `GitHub API create PR failed (${res.status}): ${text}`,
    );
  }

  const data = await res.json() as CreatePrResponse;
  return data;
}

/** Enable auto-merge on a pull request via GitHub GraphQL API. */
async function enableAutoMerge(
  pullRequestId: string,
  token: string,
): Promise<void> {
  const query = `
    mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
        pullRequest {
          autoMergeRequest {
            enabledAt
          }
        }
      }
    }
  `;

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        pullRequestId,
        mergeMethod: "MERGE",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub GraphQL enable auto-merge failed (${res.status}): ${text}`,
    );
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(
      `GitHub GraphQL errors: ${JSON.stringify(json.errors)}`,
    );
  }
}

/** Parse CLI args into options. Exported for testing. */
export function parseArgs(
  args: string[] = Deno.args,
  env: { get(key: string): string | undefined } = Deno.env,
): CreatePrOptions & { token: string } {
  const get = (flag: string): string => {
    const i = args.indexOf(flag);
    if (i === -1 || !args[i + 1]) {
      throw new Error(`Missing required argument: ${flag} <value>`);
    }
    return args[i + 1];
  };

  const token = env.get("GITHUB_TOKEN") ?? env.get("GH_TOKEN") ?? "";
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN environment variable required");
  }

  return {
    owner: get("--owner"),
    repo: get("--repo"),
    head: get("--head"),
    base: get("--base"),
    title: get("--title"),
    body: get("--body"),
    token,
  };
}

if (import.meta.main) {
  try {
    const opts = parseArgs();
    const pr = await createPullRequest(opts);
    if (pr === null) {
      console.log(
        "Pull request already exists for this head branch; nothing to do.",
      );
      Deno.exit(0);
    }
    console.log(`Created PR #${pr.number}: ${pr.html_url}`);

    await enableAutoMerge(pr.node_id, opts.token);
    console.log("Enabled auto-merge on PR");
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    Deno.exit(1);
  }
}
