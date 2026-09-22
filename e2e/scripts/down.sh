#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🧹 Tearing down ephemeral Fluxer E2E stack (project: fluxer-e2e)..."
cd "$E2E_DIR"

docker compose -p fluxer-e2e -f docker-compose.e2e.yml down -v --remove-orphans
rm -f .env.test
echo "✅ Ephemeral E2E stack wiped clean."
