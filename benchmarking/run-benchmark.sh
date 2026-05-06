#!/bin/bash
# Build AdNauseam extension for Chromium (dev mode) and run the benchmark.
# Usage: ./run-benchmark.sh [scenario] [duration_minutes]
#
# Examples:
#   ./run-benchmark.sh              # mixed scenario, 30 min
#   ./run-benchmark.sh news 10     # news scenario, 10 min
#   ./run-benchmark.sh custom 60   # custom URLs, 60 min

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SCENARIO="${1:-mixed}"
DURATION="${2:-10}"

echo "=== AdNauseam Benchmark ==="
echo "Scenario: $SCENARIO"
echo "Duration: $DURATION minutes"
echo ""

# Step 1: Patch core.js for dev mode (production=0) if not already patched
CORE_JS="$PROJECT_ROOT/src/js/adn/core.js"
if grep -q "const production = 1;" "$CORE_JS"; then
  echo "[build] Patching core.js: production = 0"
  sed -i '' 's/const production = 1;/const production = 0;/' "$CORE_JS"
  PATCHED=1
fi

# Step 2: Build the extension
echo "[build] Building AdNauseam for Chromium..."
cd "$PROJECT_ROOT"
bash tools/make-chromium.sh

# Step 3: Restore core.js if we patched it
if [ "$PATCHED" = "1" ]; then
  echo "[build] Restoring core.js: production = 1"
  sed -i '' 's/const production = 0;/const production = 1;/' "$CORE_JS"
fi

# Step 4: Run the benchmark
echo ""
echo "[benchmark] Starting..."
cd "$SCRIPT_DIR"
node src/index.js --scenario "$SCENARIO" --duration "$DURATION"
