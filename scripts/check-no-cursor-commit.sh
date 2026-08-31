#!/usr/bin/env bash
set -euo pipefail
RANGE="${1:-HEAD}"
if git log "$RANGE" --format=%B | grep -Eiq 'co-authored-by:.*cursor|made-with:.*cursor|cursoragent@cursor'; then
  echo "ERROR: Cursor co-author trailer in commit message. See docs/CONTRIBUTING.md"
  exit 1
fi
echo "OK: no Cursor trailers in $RANGE"
