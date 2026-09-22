#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: ci-run.sh
# Purpose: Orchestrates E2E image preparation, stack startup, data seeding,
#          Playwright test execution, and teardown for CI & nightly rebase jobs.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$E2E_DIR/.." && pwd)"

SKIP_BUILD=false
BUILD_ALL=false
CLEANUP=true
PASSTHROUGH_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=true
      ;;
    --build-all)
      BUILD_ALL=true
      ;;
    --no-cleanup)
      CLEANUP=false
      PASSTHROUGH_ARGS+=("--no-cleanup")
      ;;
    *)
      PASSTHROUGH_ARGS+=("$arg")
      ;;
  esac
done

echo "=================================================="
echo "🚀 Fluxer E2E Automated Integration Test Pipeline"
echo "  Repo Dir:   $REPO_DIR"
echo "  E2E Dir:    $E2E_DIR"
echo "  Skip Build: $SKIP_BUILD"
echo "  Build All:  $BUILD_ALL"
echo "=================================================="

# ------------------------------------------------------------------------------
# 1. Image Preparation
# ------------------------------------------------------------------------------
BUILD_COMPOSE="$E2E_DIR/docker-compose.e2e-build.yml"
if [ ! -f "$BUILD_COMPOSE" ] && [ -f "$REPO_DIR/docker-compose.build.yml" ]; then
  BUILD_COMPOSE="$REPO_DIR/docker-compose.build.yml"
fi

if [ "$SKIP_BUILD" = false ]; then
  if [ "$BUILD_ALL" = true ]; then
    echo "🔨 Building all 8 custom Fluxer microservices from source..."
    docker compose -f "$BUILD_COMPOSE" build \
      api app-proxy messages gateway static-proxy snowflakes users media-proxy
  else
    echo "📥 Pulling upstream base images for auxiliary services with no custom changes..."
    for svc in snowflakes users media-proxy gateway; do
      echo "  Checking / pulling ghcr.io/fluxerapp/fluxer-${svc}:v1..."
      docker pull "ghcr.io/fluxerapp/fluxer-${svc}:v1" --quiet || true
      docker tag "ghcr.io/fluxerapp/fluxer-${svc}:v1" "fluxer-custom/fluxer-${svc}:bleeding-edge" || true
    done

    echo "🔨 Building custom subprofile microservices from source (api, app-proxy, messages, static-proxy)..."
    docker compose -f "$BUILD_COMPOSE" build \
      api app-proxy messages static-proxy
  fi
  echo "✅ Docker images ready."
else
  echo "⏩ Skipping Docker image builds as requested (--skip-build)."
fi

# ------------------------------------------------------------------------------
# 2. Install E2E runner dependencies
# ------------------------------------------------------------------------------
echo "📦 Ensuring E2E runner workspace dependencies are installed..."
cd "$E2E_DIR"
CI=true pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------
# 3. Execute E2E Suite via run-all.sh
# ------------------------------------------------------------------------------
echo "🧪 Running full E2E test lifecycle..."
TEST_EXIT=0
"$SCRIPT_DIR/run-all.sh" "${PASSTHROUGH_ARGS[@]}" || TEST_EXIT=$?

# ------------------------------------------------------------------------------
# 4. Defensive permissions fix for CI artifact upload
# ------------------------------------------------------------------------------
if [ -d "$E2E_DIR/playwright-report" ] || [ -d "$E2E_DIR/test-results" ]; then
  chmod -R a+rX "$E2E_DIR/playwright-report" "$E2E_DIR/test-results" 2>/dev/null || true
  if command -v sudo >/dev/null 2>&1; then
    sudo -n chmod -R a+rX "$E2E_DIR/playwright-report" "$E2E_DIR/test-results" 2>/dev/null || true
  fi
fi

if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ E2E test execution failed with exit code $TEST_EXIT"
  exit $TEST_EXIT
fi

echo "🎉 E2E integration test pipeline finished successfully!"
