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
PULL_UNCHANGED=false
CLEANUP=true
PASSTHROUGH_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=true
      ;;
    --build-all)
      # Building everything from source is the default; kept so old invocations still work.
      ;;
    --pull-unchanged)
      PULL_UNCHANGED=true
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
echo "  Repo Dir:       $REPO_DIR"
echo "  E2E Dir:        $E2E_DIR"
echo "  Skip Build:     $SKIP_BUILD"
echo "  Pull Unchanged: $PULL_UNCHANGED"
echo "=================================================="

# ------------------------------------------------------------------------------
# 1. Image Preparation
# ------------------------------------------------------------------------------
# E2E images live under their own fluxer-e2e/*:local tags. They must never share
# the fluxer-custom/*:bleeding-edge tags that docker-compose.build.yml produces
# and production runs, or an E2E run could change what the next deploy ships.
BUILD_COMPOSE="$E2E_DIR/docker-compose.e2e-build.yml"
RUN_COMPOSE="$E2E_DIR/docker-compose.e2e.yml"

E2E_IMAGES=($(docker compose -f "$RUN_COMPOSE" config --images | grep '^fluxer-' | sort -u))
for img in "${E2E_IMAGES[@]}"; do
  if [[ "$img" != fluxer-e2e/* ]]; then
    echo "❌ $RUN_COMPOSE references '$img'; E2E images must be tagged fluxer-e2e/*."
    exit 1
  fi
done

if [ "$SKIP_BUILD" = false ]; then
  # On hosts that also serve traffic, a throttled buildx builder named "lowprio" may
  # exist. Use it when present so builds do not starve running services.
  if [ -z "${BUILDX_BUILDER:-}" ] && docker buildx inspect lowprio >/dev/null 2>&1; then
    export BUILDX_BUILDER=lowprio
    echo "🐢 Building at low priority through the 'lowprio' builder."
  fi
  ALL_SERVICES=($(docker compose -f "$BUILD_COMPOSE" config --services))

  if [ "$PULL_UNCHANGED" = false ]; then
    echo "🔨 Building all ${#ALL_SERVICES[@]} custom Fluxer microservices from source (${ALL_SERVICES[*]})..."
    COMPOSE_BAKE=true docker compose -f "$BUILD_COMPOSE" build "${ALL_SERVICES[@]}"
  else
    # Opt-in shortcut: reuse upstream's released image for services whose own
    # directory is unchanged. The check does not see shared crates or packages,
    # so the stack under test may not match this tree exactly.
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
        target_img="$(docker compose -f "$BUILD_COMPOSE" config --images "$svc")"
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
      COMPOSE_BAKE=true docker compose -f "$BUILD_COMPOSE" build "${SERVICES_TO_BUILD[@]}"
    fi
  fi
  echo "✅ Docker images ready."
else
  echo "⏩ Skipping Docker image builds as requested (--skip-build)."
  for img in "${E2E_IMAGES[@]}"; do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      echo "❌ $img does not exist yet; run once without --skip-build to build the E2E images."
      exit 1
    fi
  done
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
