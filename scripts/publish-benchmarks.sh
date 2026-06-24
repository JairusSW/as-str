#!/bin/bash
# Publish the benchmark charts to the `docs` branch under charts/v<version>/,
# then re-pin the README chart <img> URLs to that version. Ported from json-as's
# scripts/publish-benchmarks.sh.
#
# Publishing never commits the main working tree: charts are built into
# ./build/charts (gitignored) and committed only inside a separate `docs`
# worktree, so a dirty/untracked main tree is safe.
#
#   ./scripts/publish-benchmarks.sh            # bench both builds, render, publish
#   ./scripts/publish-benchmarks.sh --no-run   # reuse existing logs, just render+publish
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_NAME="${REMOTE_NAME:-origin}"
DOCS_BRANCH="${DOCS_BRANCH:-docs}"
VERSION="$(node -p "require('./package.json').version")"
RUN_BENCHES=1
TMP_CHARTS_DIR="$(mktemp -d)"
TMP_DOCS_DIR="$(mktemp -d)"
WORKTREE_ADDED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-run)
      RUN_BENCHES=0
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/publish-benchmarks.sh [--no-run]"
      exit 1
      ;;
  esac
done

cleanup() {
  rm -rf "$TMP_CHARTS_DIR"
  if [[ "$WORKTREE_ADDED" == "1" ]]; then
    git worktree remove --force "$TMP_DOCS_DIR" >/dev/null 2>&1 || true
  else
    rm -rf "$TMP_DOCS_DIR"
  fi
}
trap cleanup EXIT

# A dirty/changed/untracked main tree is safe (we only commit inside the docs
# worktree) - charts just reflect your current (possibly uncommitted) source.
# Set PUBLISH_REQUIRE_CLEAN=1 to restore a refuse-if-dirty guard.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  if [[ "${PUBLISH_REQUIRE_CLEAN:-0}" == "1" ]]; then
    echo "Refusing to publish benchmarks with a dirty tracked working tree (PUBLISH_REQUIRE_CLEAN=1)."
    echo "Commit or stash your changes first."
    exit 1
  fi
  echo "⚠️  Working tree has uncommitted changes - charts will reflect them (HEAD: $(git rev-parse --short HEAD))."
fi

if [[ "$RUN_BENCHES" == "1" ]]; then
  echo "Benchmarking + rendering charts..."
  ./scripts/build-charts.sh
else
  echo "Reusing existing logs - rendering charts only..."
  bun ./scripts/build-throughput.ts
  bun ./scripts/build-per-op.ts
fi

test -d ./build/charts
compgen -G "./build/charts/*" > /dev/null
cp -R ./build/charts/. "$TMP_CHARTS_DIR/"

echo "Preparing ${DOCS_BRANCH} worktree..."
git fetch "$REMOTE_NAME" "$DOCS_BRANCH" >/dev/null 2>&1 || true
if git show-ref --verify --quiet "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}"; then
  git worktree add --detach "$TMP_DOCS_DIR" "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}" >/dev/null
  WORKTREE_ADDED=1
  (
    cd "$TMP_DOCS_DIR"
    git checkout -B "$DOCS_BRANCH" >/dev/null
  )
else
  git worktree add --detach "$TMP_DOCS_DIR" >/dev/null
  WORKTREE_ADDED=1
  (
    cd "$TMP_DOCS_DIR"
    git checkout --orphan "$DOCS_BRANCH" >/dev/null
    git rm -rf . >/dev/null 2>&1 || true
  )
fi

# Publish under charts/v<version>/ so each release keeps its own chart set.
# Re-publishing a version overwrites just that folder; other versions untouched.
DEST="v${VERSION}"
echo "Updating charts/${DEST} on ${DOCS_BRANCH}..."
rm -rf "$TMP_DOCS_DIR/charts/${DEST}"
mkdir -p "$TMP_DOCS_DIR/charts/${DEST}"
cp -R "$TMP_CHARTS_DIR/." "$TMP_DOCS_DIR/charts/${DEST}/"

(
  cd "$TMP_DOCS_DIR"
  git add -A charts
  if git diff --cached --quiet; then
    echo "No chart changes to publish for ${DEST}."
    exit 0
  fi

  git config user.name "${GIT_AUTHOR_NAME:-$(git config --get user.name || echo str-as)}"
  git config user.email "${GIT_AUTHOR_EMAIL:-$(git config --get user.email || echo str-as@example.com)}"
  git commit -m "Update benchmark charts for ${DEST} [skip ci]" >/dev/null
  git push "$REMOTE_NAME" "$DOCS_BRANCH"
)

# Re-pin the README chart <img> URLs to the version just published, so a README
# revision references the charts built from its own code. Left uncommitted for
# you to review and commit.
echo "Pinning README chart URLs to charts/${DEST}/..."
sed -i -E "s#(/refs/heads/${DOCS_BRANCH}/charts/)([^\"']*/)?([^/\"']+\.(svg|png))#\1${DEST}/\3#g" README.md
# Re-point the "Browse the full chart set" tree link to this version's folder
# (e.g. /tree/docs/charts/v0.1.0 -> /tree/docs/charts/v0.2.0).
sed -i -E "s#(/tree/${DOCS_BRANCH}/charts/)v[0-9][0-9.]*#\1${DEST}#g" README.md

echo "Benchmark charts published to ${REMOTE_NAME}/${DOCS_BRANCH}:charts/${DEST}/."
echo "README pinned to https://raw.githubusercontent.com/JairusSW/str-as/refs/heads/${DOCS_BRANCH}/charts/${DEST}/"
