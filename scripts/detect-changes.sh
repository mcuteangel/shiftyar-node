#!/bin/sh
# POSIX sh compatible (also invoked as `bash scripts/detect-changes.sh` in CI).
set -eu
# dash/BSD sh lack `set -o pipefail`; enable it only where supported.
(set -o pipefail) 2>/dev/null && set -o pipefail || true

# detect-changes.sh - Determines whether application code changed.
# Exit code 0 = release needed, exit code 1 = skip release.
#
# Usage: ./scripts/detect-changes.sh <base_ref> <head_ref>
# Example: ./scripts/detect-changes.sh origin/main HEAD
#
# Application files are exactly the contents of the launcher app package:
# server/, web/, and package.json. Launcher files, docs, and workflow
# files never trigger a release on their own.

BASE_REF="${1:?Usage: detect-changes.sh <base_ref> <head_ref>}"
HEAD_REF="${2:-HEAD}"

# Handle zero SHA (initial push) - treat as all files changed
if echo "$BASE_REF" | grep -qE '^0+$'; then
  echo "RELEASE_NEEDED: Initial push detected (zero SHA base)"
  exit 0
fi

changed_files=$(git diff --name-status "$BASE_REF"... "$HEAD_REF" 2>/dev/null || \
                git diff --name-status "$BASE_REF".."$HEAD_REF" 2>/dev/null || \
                git diff --name-status "$BASE_REF" "$HEAD_REF" 2>/dev/null || \
                echo "")

if [ -z "$changed_files" ]; then
  echo "SKIP: No changed files detected between $BASE_REF and $HEAD_REF"
  exit 1
fi

CHANGED_LIST=$(mktemp "${TMPDIR:-/tmp}/detect-changes.XXXXXX")
trap 'rm -f "$CHANGED_LIST"' EXIT
printf '%s\n' "$changed_files" > "$CHANGED_LIST"

# Check if any application files changed. The diff uses --name-status, so
# a rename line carries both the old and the new path. Test every word on
# the line: a rename out of server/ or web/ must still count, even though
# only its destination sits outside the app paths.
has_app_changes=false
while IFS= read -r line; do
  [ -z "$line" ] && continue

  for file in $line; do
    case "$file" in
      server/*|web/*|package.json)
        has_app_changes=true
        break 2
        ;;
    esac
  done
done < "$CHANGED_LIST"

if [ "$has_app_changes" = false ]; then
  echo "SKIP: No application code changes detected"
  echo "Changed files:"
  echo "$changed_files" | head -20
  exit 1
fi

echo "RELEASE_NEEDED: Application code changes detected"
echo "Changed files:"
echo "$changed_files" | head -30
exit 0
