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
  ALL_SERVICES=($(docker compose -f "$BUILD_COMPOSE" config --services 2>/dev/null || true))
  if [ ${#ALL_SERVICES[@]} -eq 0 ]; then
    # Fallback to standard services if compose query fails
    ALL_SERVICES=(api app-proxy messages gateway static-proxy snowflakes users media-proxy)
  fi

  if [ "$BUILD_ALL" = true ]; then
    echo "🔨 Building all ${#ALL_SERVICES[@]} custom Fluxer microservices from source (${ALL_SERVICES[*]})..."
    docker compose -f "$BUILD_COMPOSE" build "${ALL_SERVICES[@]}"
  else
    UPSTREAM_REF="upstream/main"
    if ! git rev-parse --verify "$UPSTREAM_REF" >/dev/null 2>&1; then
      UPSTREAM_REF="origin/main"
    fi

    # Core subprofile services are always built from source
    CORE_SERVICES="api app-proxy messages static-proxy"
    SERVICES_TO_BUILD=()
    SERVICES_TO_PULL=()

    echo "🔍 Inspecting microservices for local changes against $UPSTREAM_REF..."
    for svc in "${ALL_SERVICES[@]}"; do
      if [[ " $CORE_SERVICES " =~ " $svc " ]]; then
        SERVICES_TO_BUILD+=("$svc")
        continue
      fi

      src_dir="fluxer_${svc//-/_}"
      if [ "$svc" = "static-proxy" ]; then
        src_dir="fluxer_static"
      fi

      if git rev-parse --verify "$UPSTREAM_REF" >/dev/null 2>&1 && ! git diff --quiet "$UPSTREAM_REF...HEAD" -- "$src_dir" 2>/dev/null; then
        echo "  ⚡ Service '$svc': changes detected in $src_dir vs $UPSTREAM_REF -> building from source."
        SERVICES_TO_BUILD+=("$svc")
      else
        SERVICES_TO_PULL+=("$svc")
      fi
    done

    if [ ${#SERVICES_TO_PULL[@]} -gt 0 ]; then
      echo "📥 Pulling upstream base images for services without local modifications (${SERVICES_TO_PULL[*]})..."
      for svc in "${SERVICES_TO_PULL[@]}"; do
        upstream_img="ghcr.io/fluxerapp/fluxer-${svc}:v1"
        target_img="fluxer-custom/fluxer-${svc}:bleeding-edge"
        echo "  Checking / pulling $upstream_img..."
        if docker pull "$upstream_img" --quiet; then
          docker tag "$upstream_img" "$target_img"
        else
          echo "  ⚠️ Upstream image $upstream_img pull failed; falling back to building '$svc' from source."
          SERVICES_TO_BUILD+=("$svc")
        fi
      done
    fi

    if [ ${#SERVICES_TO_BUILD[@]} -gt 0 ]; then
      echo "🔨 Building custom Fluxer microservices from source (${SERVICES_TO_BUILD[*]})..."
      docker compose -f "$BUILD_COMPOSE" build "${SERVICES_TO_BUILD[@]}"
    fi
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
