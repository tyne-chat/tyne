#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting ephemeral Fluxer E2E stack (project: fluxer-e2e)..."
cd "$E2E_DIR"

docker info >/dev/null 2>&1 || { echo "❌ Docker daemon not reachable"; exit 1; }

docker compose -p fluxer-e2e -f docker-compose.e2e.yml up -d --wait --wait-timeout 120

echo "🔍 Probing E2E Caddy endpoint at http://127.0.0.1:9188/_health..."
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9188/_health >/dev/null 2>&1; then
    echo "✅ Fluxer E2E stack is healthy and ready on http://127.0.0.1:9188!"
    exit 0
  fi
  sleep 1
done

echo "❌ E2E healthcheck timed out after 30 seconds"
docker compose -p fluxer-e2e -f docker-compose.e2e.yml ps
exit 1
