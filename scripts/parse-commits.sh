#!/usr/bin/env bash
set -euo pipefail

# parse-commits.sh - Parses conventional commits to determine release type.
# Outputs JSON with: bump_type (major/minor/patch), summary
#
# Usage: ./scripts/parse-commits.sh <base_ref> <head_ref>
# Example: ./scripts/parse-commits.sh origin/main HEAD

BASE_REF="${1:?Usage: parse-commits.sh <base_ref> <head_ref>}"
HEAD_REF="${2:-HEAD}"

# Read commits from base to head (try both range syntaxes)
commits=$(git log --pretty=format:"%s|||%h" "$BASE_REF".."$HEAD_REF" 2>/dev/null || \
          git log --pretty=format:"%s|||%h" "$BASE_REF"..."$HEAD_REF" 2>/dev/null || echo "")

if [ -z "$commits" ]; then
  echo '{"bump_type":"patch","summary":"Release changes"}'
  exit 0
fi

has_feat=false
has_fix=false
has_breaking=false
summary_lines=""

while IFS= read -r line; do
  [ -z "$line" ] && continue
  subject="${line%%|||*}"

  # Skip merge commits
  case "$subject" in
    "Merge "*) continue ;;
  esac

  summary_lines="${summary_lines}${subject}"$'\n'

  # Check for breaking changes (type! or BREAKING CHANGE in subject)
  case "$subject" in
    *'!:'*) has_breaking=true ;;
  esac

  # Check for feat (minor)
  case "$subject" in
    'feat('*|'feat:'*) has_feat=true ;;
  esac

  # Check for fix, perf, security, refactor (patch)
  case "$subject" in
    'fix('*|'fix:'*) has_fix=true ;;
    'perf('*|'perf:'*) has_fix=true ;;
    'security('*|'security:'*) has_fix=true ;;
    'refactor('*|'refactor:'*) has_fix=true ;;
  esac
done <<< "$commits"

# Also check for BREAKING CHANGE in commit body (try both range syntaxes)
breaking_body=$(git log --pretty=format:"%b" "$BASE_REF".."$HEAD_REF" 2>/dev/null || \
                git log --pretty=format:"%b" "$BASE_REF"..."$HEAD_REF" 2>/dev/null || echo "")
if echo "$breaking_body" | grep -q "BREAKING CHANGE"; then
  has_breaking=true
fi

# Determine bump level
if [ "$has_breaking" = true ]; then
  BUMP_TYPE="major"
elif [ "$has_feat" = true ]; then
  BUMP_TYPE="minor"
else
  BUMP_TYPE="patch"
fi

# Trim summary to 20 lines, format as bulleted list
summary_lines=$(printf '%s\n' "$summary_lines" | sed '/^$/d' | head -20 || true)
summary_bullets=""
if [ -n "$summary_lines" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ -z "$summary_bullets" ]; then
      summary_bullets="- $line"
    else
      summary_bullets="$summary_bullets"$'\n'"- $line"
    fi
  done <<< "$summary_lines"
fi

# Detect Python interpreter
PYTHON_CMD=""
if python3 --version >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif py -3 --version >/dev/null 2>&1; then
  PYTHON_CMD="py -3"
fi

# Output JSON using jq, python, or minimal shell fallback
if command -v jq >/dev/null 2>&1; then
  jq -n --arg bump_type "$BUMP_TYPE" --arg summary "$summary_bullets" \
    '{bump_type: $bump_type, summary: $summary}'
elif [ -n "$PYTHON_CMD" ]; then
  BUMP_TYPE="$BUMP_TYPE" SUMMARY_BULLETS="$summary_bullets" $PYTHON_CMD -c \
    'import json, os; print(json.dumps({"bump_type": os.environ["BUMP_TYPE"], "summary": os.environ["SUMMARY_BULLETS"]}))'
else
  # Shell fallback escaping backslashes, double quotes, and newlines
  escaped_summary=$(printf '%s' "$summary_bullets" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{if (NR>1) printf "\\n"; printf "%s", $0}')
  printf '{"bump_type":"%s","summary":"%s"}\n' "$BUMP_TYPE" "$escaped_summary"
fi
