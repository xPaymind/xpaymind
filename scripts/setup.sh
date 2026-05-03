#!/usr/bin/env bash
set -euo pipefail
echo "xPaymind Development Setup"
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node.js 20+ required"; exit 1; fi
if ! command -v pnpm &> /dev/null; then echo "pnpm not found — install: npm install -g pnpm"; exit 1; fi
pnpm install
pnpm build
echo "Setup complete!"
