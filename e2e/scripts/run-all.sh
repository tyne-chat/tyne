#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$E2E_DIR"

CLEANUP=true
TEST_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--no-cleanup" ]; then
    CLEANUP=false
  else
    TEST_ARGS+=("$arg")
  fi
done

cleanup() {
  if [ "$CLEANUP" = true ]; then
    "$SCRIPT_DIR/down.sh"
  else
    echo "ℹ️  --no-cleanup specified; leaving fluxer-e2e stack running on http://127.0.0.1:9188"
  fi
}
trap cleanup EXIT

# 1. Start stack
"$SCRIPT_DIR/up.sh"

# 2. Seed data
"$SCRIPT_DIR/seed.sh"

# 3. Run Playwright tests inside test-runner container
echo "🧪 Running Playwright E2E tests inside Docker test-runner..."
docker compose -p fluxer-e2e -f docker-compose.e2e.yml exec -T test-runner \
  npx playwright test "${TEST_ARGS[@]}"

echo "🎉 All E2E tests passed successfully!"
