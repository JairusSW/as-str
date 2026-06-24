#!/usr/bin/env bash
set -euo pipefail

echo "Running formatter..."
npm run format

if ! git diff --quiet; then
  echo
  echo "Formatting changed files. Review, stage, and commit those changes before committing."
  git --no-pager diff --stat
  exit 1
fi

echo "Running linter..."
npm run lint
