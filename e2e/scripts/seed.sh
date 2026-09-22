#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$E2E_DIR"

echo "🌱 Seeding 3 test accounts & personas inside test-runner container..."
docker compose -p fluxer-e2e -f docker-compose.e2e.yml exec -T test-runner \
  npx tsx api-helpers/seed.ts
