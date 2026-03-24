#!/usr/bin/env bash
# CircleCI: semantic version bump, tag, push release branch, open PR to main.
# See scripts/release.ts for bump rules. Orphan tags (pushed with release branch
# but not merged into main) trigger PR creation only so the pipeline can unstick.

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

NEXT_VERSION="$(
  deno run --allow-read --allow-run scripts/release.ts --dry-run |
    head -n 1
)"
NEXT_VERSION="${NEXT_VERSION//$'\r'/}"
NEXT_VERSION="$(printf '%s' "$NEXT_VERSION" | tr -d '\n')"

if [ -z "$NEXT_VERSION" ]; then
  echo "No semantic version bump required."
  exit 0
fi

RELEASE_TAG="v${NEXT_VERSION}"
RELEASE_BRANCH="release/${NEXT_VERSION}"

DISPOSITION="$(
  deno run --allow-read --allow-run scripts/release.ts --tag-disposition "$RELEASE_TAG"
)"
DISPOSITION="$(printf '%s' "$DISPOSITION" | tr -d '\n\r')"

case "$DISPOSITION" in
  merged)
    echo "Release tag ${RELEASE_TAG} is already merged into main. Skipping."
    exit 0
    ;;
  orphan)
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
  absent) ;;
  *)
    echo "Unexpected tag disposition: ${DISPOSITION:-empty}"
    exit 1
    ;;
esac

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

deno task coverage:baseline
git add coverage-baseline.json 2>/dev/null || true

if git diff --cached --quiet; then
  echo "No deno.json, CHANGELOG.md, or coverage-baseline.json changes to commit."
  exit 0
fi

git commit -m "chore(release): ${RELEASE_TAG} [skip ci]"
git checkout -b "$RELEASE_BRANCH"

if git rev-parse "$RELEASE_TAG" >/dev/null 2>&1; then
  echo "Tag ${RELEASE_TAG} already exists locally (e.g. from fetch). Skipping git tag -a."
else
  git tag -a "$RELEASE_TAG" -F release-notes.md
fi

git push origin "$RELEASE_BRANCH"

if git push origin "$RELEASE_TAG" 2>/dev/null; then
  :
else
  echo "Tag ${RELEASE_TAG} may already exist on remote. Continuing if branch push succeeded."
fi

deno run --allow-net --allow-env scripts/create-release-pr.ts \
  --owner "$OWNER" \
  --repo "$REPO" \
  --head "$RELEASE_BRANCH" \
  --base main \
  --title "chore(release): ${RELEASE_TAG} [skip ci]" \
  --body "Release ${RELEASE_TAG}. Auto-merge enabled."
