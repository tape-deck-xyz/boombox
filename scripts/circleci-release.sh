#!/usr/bin/env bash
# CircleCI release job (see .circleci/config.yml "release").
#
# Prerequisites (earlier CI steps):
# - checkout, "Prepare git for release" (fetch tags, checkout main at CIRCLE_SHA1,
#   optional HTTPS remote with GITHUB_TOKEN for push).
# - GITHUB_TOKEN or GH_TOKEN for create-release-pr.ts (GraphQL + REST).
# - CIRCLE_PROJECT_USERNAME / CIRCLE_PROJECT_REPONAME for GitHub API paths.
#
# Behaviour summary:
# - Computes next semver from conventional commits (scripts/release.ts).
# - If that tag already exists on main's history → nothing to do.
# - If the tag exists only on a release branch (orphan) → retry opening the PR.
# - Otherwise → write files, commit, tag, push branch + tag, open PR to main.
#
# Orphan tags: a prior run may have pushed tag + release/* without merging the PR.
# We must not treat "tag exists in the repo" as "released on main"; see
# getReleaseTagDisposition in scripts/release.ts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

OWNER="${CIRCLE_PROJECT_USERNAME:-}"
REPO="${CIRCLE_PROJECT_REPONAME:-}"
if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "CIRCLE_PROJECT_USERNAME and CIRCLE_PROJECT_REPONAME must be set."
  exit 1
fi

# --- Next version (read-only): no writes to deno.json yet --------------------
NEXT_VERSION="$(
  deno run --allow-read --allow-run scripts/release.ts --dry-run |
    head -n 1
)"
# Normalize: strip CR and any stray newlines from captured output.
NEXT_VERSION="${NEXT_VERSION//$'\r'/}"
NEXT_VERSION="$(printf '%s' "$NEXT_VERSION" | tr -d '\n')"

if [ -z "$NEXT_VERSION" ]; then
  echo "No semantic version bump required."
  exit 0
fi

RELEASE_TAG="v${NEXT_VERSION}"
RELEASE_BRANCH="release/${NEXT_VERSION}"

# --- Classify whether tag vX.Y.Z points at a commit already on main ----------
# absent: no such tag; merged: tag's commit is ancestor of HEAD; orphan: tag exists elsewhere.
DISPOSITION="$(
  deno run --allow-read --allow-run scripts/release.ts --tag-disposition "$RELEASE_TAG"
)"
DISPOSITION="$(printf '%s' "$DISPOSITION" | tr -d '\n\r')"

case "$DISPOSITION" in
  merged)
    # Release already landed on main; deno.json on main should match after merge.
    echo "Release tag ${RELEASE_TAG} is already merged into main. Skipping."
    exit 0
    ;;
  orphan)
    # Tag + branch may exist from a failed or incomplete PR step; do not rebuild—
    # only ensure the PR exists so a human or auto-merge can merge to main.
    echo "Orphan tag ${RELEASE_TAG} exists but is not merged into main."
    if git ls-remote --heads origin "$RELEASE_BRANCH" | grep -q .; then
      echo "Remote branch ${RELEASE_BRANCH} found. Opening or retrying release PR."
      deno run --allow-net --allow-env scripts/create-release-pr.ts \
        --owner "$OWNER" \
        --repo "$REPO" \
        --head "$RELEASE_BRANCH" \
        --base main \
        --title "chore(release): ${RELEASE_TAG} [skip ci]" \
        --body "Release ${RELEASE_TAG}. Auto-merge enabled."
      exit 0
    fi
    echo "No remote branch ${RELEASE_BRANCH}. Remove the orphan tag or push the branch, then re-run."
    exit 1
    ;;
  absent)
    # Normal path: create release commit, branch, tag, push, then open PR.
    ;;
  *)
    echo "Unexpected tag disposition: ${DISPOSITION:-empty}"
    exit 1
    ;;
esac

# --- Full release: write deno.json, CHANGELOG, release-notes.md --------------
NEXT_VERSION="$(
  deno run --allow-read --allow-write --allow-run scripts/release.ts
)"
NEXT_VERSION="${NEXT_VERSION//$'\r'/}"
NEXT_VERSION="$(printf '%s' "$NEXT_VERSION" | tr -d '\n')"

if [ -z "$NEXT_VERSION" ]; then
  echo "release.ts did not print a version (release failed or no bump)."
  exit 1
fi

RELEASE_TAG="v${NEXT_VERSION}"
RELEASE_BRANCH="release/${NEXT_VERSION}"

git add deno.json
git add CHANGELOG.md 2>/dev/null || true

# Match release policy: refresh coverage baseline at release time.
deno task coverage:baseline
git add coverage-baseline.json 2>/dev/null || true

if git diff --cached --quiet; then
  echo "No deno.json, CHANGELOG.md, or coverage-baseline.json changes to commit."
  exit 0
fi

git commit -m "chore(release): ${RELEASE_TAG} [skip ci]"
# Release commit lives only on release/* until the PR merges; main is not pushed here.
git checkout -b "$RELEASE_BRANCH"

if git rev-parse "$RELEASE_TAG" >/dev/null 2>&1; then
  # git fetch --tags may have loaded this tag; do not fail `git tag -a` on duplicate.
  echo "Tag ${RELEASE_TAG} already exists locally (e.g. from fetch). Skipping git tag -a."
else
  git tag -a "$RELEASE_TAG" -F release-notes.md
fi

git push origin "$RELEASE_BRANCH"

if git push origin "$RELEASE_TAG" 2>/dev/null; then
  :
else
  # Idempotent: same tag may already exist on origin from a partial run.
  echo "Tag ${RELEASE_TAG} may already exist on remote. Continuing if branch push succeeded."
fi

deno run --allow-net --allow-env scripts/create-release-pr.ts \
  --owner "$OWNER" \
  --repo "$REPO" \
  --head "$RELEASE_BRANCH" \
  --base main \
  --title "chore(release): ${RELEASE_TAG} [skip ci]" \
  --body "Release ${RELEASE_TAG}. Auto-merge enabled."
