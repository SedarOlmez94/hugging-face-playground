#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if command -v clive >/dev/null 2>&1; then
  exec clive session --model "${CLIVE_MODEL:-qwen2.5-coder:latest}"
else
  echo "clive is not installed or not on PATH. Install it with: cargo install --path clive"
  exit 1
fi
