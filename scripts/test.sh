#!/usr/bin/env bash
# Run the full test suite.
#
# Tests are TypeScript and run through tsx on top of node:test. No transpile
# step, no test framework dependency.
set -euo pipefail

cd "$(dirname "$0")/.."

files=$(find tests -name '*.test.ts' -type f | sort)

if [ -z "$files" ]; then
  echo "No test files found under tests/" >&2
  exit 1
fi

# shellcheck disable=SC2086
node --import tsx --test $files
