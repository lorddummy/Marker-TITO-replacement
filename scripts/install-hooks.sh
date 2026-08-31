#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$ROOT/scripts/hooks/prepare-commit-msg" "$ROOT/.git/hooks/prepare-commit-msg"
chmod +x "$ROOT/.git/hooks/prepare-commit-msg"
echo "Installed prepare-commit-msg hook"
