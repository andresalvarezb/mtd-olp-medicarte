#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

ROOT="$(
  cd "$SCRIPT_DIR/.." &&
  pwd
)"

cd "$ROOT"

echo "=========================================="
echo "MTD - ENTORNO DE DESARROLLO"
echo "=========================================="
echo "ROOT=$ROOT"
echo
echo "DATABASE_MODE=PRODUCTION_MIGRATED_SHADOW"
echo "DATABASE=${DEV_DATABASE:-authorization_prod_220926_migrated}"
echo "SOURCE_DATABASE=authorization_prod_220926_source [READ ONLY]"
echo

echo "Infraestructura Docker..."

docker compose \
  -p mtd-ui-dev \
  -f "$ROOT/docker-compose.yml" \
  -f "$ROOT/docker-compose.dev.yml" \
  up -d \
  --no-build \
  postgres redis mipres-mock

echo
echo "Compilando paquetes compartidos..."

pnpm --filter @authorization/config build
pnpm --filter @authorization/contracts build
pnpm --filter @authorization/database build
pnpm --filter @authorization/domain build

echo
echo "=========================================="
echo "INICIANDO BACKEND"
echo "=========================================="

(
  cd "$ROOT"

  export NODE_ENV=development

  export DEV_DATABASE="${DEV_DATABASE:-authorization_prod_220926_migrated}"
  export DATABASE_URL="postgresql://authorization:authorization@127.0.0.1:15432/${DEV_DATABASE}"
  export REDIS_URL="redis://127.0.0.1:6379"

  export API_PORT=3001
  export API_PUBLIC_URL="http://localhost:3001"
  export WEB_ORIGIN="http://localhost:3002"

  export AUTH_JWT_SECRET="0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"
  export AUTH_JWT_TTL_SECONDS=28800

  export AUTH_BOOTSTRAP_ADMIN_USERNAME="foundation-admin"
  export AUTH_BOOTSTRAP_ADMIN_PASSWORD="foundation-admin"

  export IMPORT_MAX_FILE_BYTES=20971520
  export IMPORT_PROCESSOR_VERSION=2

  export MIPRES_BASE_URL="http://localhost:18090"
  export MIPRES_NIT="900123456"
  export MIPRES_INITIAL_TOKEN="initial-secret"
  export MIPRES_MANUAL_RECHECK_DAILY_LIMIT=3

  export THROTTLE_GLOBAL_LIMIT=1000
  export AUTH_LOGIN_THROTTLE_LIMIT=1000

  export RECONCILIATION_SCHEDULER_ENABLED=false
  export SCHEDULER_ENABLED=false

  exec pnpm --filter @authorization/api dev
) &

API_PID=$!

echo "API_PID=$API_PID"

echo
echo "=========================================="
echo "INICIANDO FRONTEND"
echo "=========================================="

(
  cd "$ROOT"

  export NODE_ENV=development
  export NEXT_PUBLIC_API_URL="http://localhost:3001/api/v1"

  exec pnpm \
    --filter @authorization/web \
    exec next dev \
    --hostname 0.0.0.0 \
    --port 3002
) &

WEB_PID=$!

echo "WEB_PID=$WEB_PID"

cleanup() {
  echo
  echo "Deteniendo API y WEB locales..."

  kill "$API_PID" \
       "$WEB_PID" \
       2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo
echo "=========================================="
echo "DESARROLLO ACTIVO"
echo "=========================================="
echo
echo "WEB : http://localhost:3002"
echo "API : http://localhost:3001/api/v1"
echo
echo "Cambios de código:"
echo "  WEB -> hot reload"
echo "  API -> hot reload"
echo
echo "NO Docker build."
echo "NO restart por cambios de código."
echo
echo "Ctrl+C para detener API/WEB."
echo

wait
