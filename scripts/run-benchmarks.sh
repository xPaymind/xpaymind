#!/usr/bin/env bash
set -euo pipefail
AGENT_PATH="${1:-}"
SUITE="${2:-standard}"
ITERATIONS="${3:-10}"
if [ -z "$AGENT_PATH" ]; then echo "Usage: ./scripts/run-benchmarks.sh <agent-path> [suite] [iterations]"; exit 1; fi
xpaymind benchmark run --agent "$AGENT_PATH" --suite "$SUITE" --iterations "$ITERATIONS" --format table
