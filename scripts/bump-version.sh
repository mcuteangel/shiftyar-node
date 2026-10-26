#!/usr/bin/env bash
set -euo pipefail

# bump-version.sh - Reads package.json version, applies semver bump,
# writes the new version back. Only the version line changes; the rest
# of package.json is left byte-identical.
# Outputs the new version on stdout.
#
# Usage: ./scripts/bump-version.sh <major|minor|patch>
# Example: ./scripts/bump-version.sh minor

BUMP_TYPE="${1:?Usage: bump-version.sh <major|minor|patch>}"
VERSION_FILE="${VERSION_FILE:-package.json}"

if [ ! -f "$VERSION_FILE" ]; then
  echo "ERROR: $VERSION_FILE not found" >&2
  exit 1
fi

current=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$VERSION_FILE" | head -n1 | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
if [ -z "$current" ]; then
  echo "ERROR: no semver version found in $VERSION_FILE" >&2
  exit 1
fi

IFS='.' read -r major minor patch <<< "$current"

case "$BUMP_TYPE" in
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
  minor)
    minor=$((minor + 1))
    patch=0
    ;;
  patch)
    patch=$((patch + 1))
    ;;
  *)
    echo "ERROR: Invalid bump type: $BUMP_TYPE (must be major, minor, or patch)" >&2
    exit 1
    ;;
esac

new_version="${major}.${minor}.${patch}"
sed -E -i "s/(\"version\"[[:space:]]*:[[:space:]]*\")${current}(\")/\1${new_version}\2/" "$VERSION_FILE"
echo "Version bumped: $current -> $new_version" >&2
echo "$new_version"
