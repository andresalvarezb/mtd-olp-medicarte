#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

ROOT="$(
  cd "$SCRIPT_DIR/.." &&
  pwd
)"

ENV_FILE="${LOCAL_ENV_FILE:-$ROOT/.env.local}"
COMPOSE_FILE="$ROOT/docker-compose.local.yml"

cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.local.example" "$ENV_FILE"
  echo "Creado: $ENV_FILE"
fi

DC=(
  docker compose
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
)

COMMAND="${1:-up}"

case "$COMMAND" in

  up)
    echo "=========================================="
    echo "MTD OLP MEDICARTE - DESARROLLO"
    echo "=========================================="

    echo
    echo "Levantando PostgreSQL, Redis, MIPRES y entorno DEV..."

    "${DC[@]}" up \
      -d \
      --wait \
      --wait-timeout 180 \
      postgres \
      redis \
      mipres-mock \
      dev

    echo
    echo "=========================================="
    echo "ENTORNO DISPONIBLE"
    echo "=========================================="
    echo
    echo "WEB : http://localhost:${WEB_HOST_PORT:-3002}"
    echo "API : http://localhost:${API_HOST_PORT:-3001}/api/v1"
    echo
    echo "Hot reload: ACTIVO"
    echo "Rebuild por cambios de código: NO"
    echo

    "${DC[@]}" ps
    ;;


  down)
    echo "=========================================="
    echo "DETENIENDO ENTORNO LOCAL"
    echo "=========================================="

    "${DC[@]}" down \
      --remove-orphans
    ;;


  restart)
    "${DC[@]}" down --remove-orphans
    bash "$0" up
    ;;



  reset)
    echo "=========================================="
    echo "RESET COMPLETO"
    echo "SE ELIMINARA LA BASE LOCAL"
    echo "=========================================="

    "${DC[@]}" down \
      -v \
      --remove-orphans

    "${DC[@]}" up \
      -d \
      --build \
      --remove-orphans

    "${DC[@]}" ps
    ;;


  rebuild)
    echo "=========================================="
    echo "BUILD FINAL DE VALIDACION"
    echo "=========================================="

    "${DC[@]}" --profile release build \
      api \
      worker \
      web

    echo
    echo "BUILD_FINAL=TERMINADO"
    ;;



  status)
    "${DC[@]}" ps
    ;;


  logs)
    shift || true

    "${DC[@]}" logs \
      -f \
      --tail=100 \
      "$@"
    ;;


  config)
    "${DC[@]}" config
    ;;


  doctor)
    echo "=========================================="
    echo "DOCKER"
    echo "=========================================="

    docker version \
      --format 'Docker Engine: {{.Server.Version}}'

    docker compose version

    echo
    echo "=========================================="
    echo "COMPOSE CONFIG"
    echo "=========================================="

    "${DC[@]}" config --quiet

    echo "COMPOSE_CONFIG=PASS"

    echo
    echo "ENV_FILE=$ENV_FILE"
    echo "COMPOSE_FILE=$COMPOSE_FILE"
    ;;


  restore-db)
    set -a
    source "$ENV_FILE"
    set +a

    if [ -z "${LOCAL_DB_BACKUP_PATH:-}" ]; then
      echo "ERROR: LOCAL_DB_BACKUP_PATH no está definido en .env.local"
      break
    fi

    if [ ! -f "$LOCAL_DB_BACKUP_PATH" ]; then
      echo "ERROR: no existe el dump:"
      echo "$LOCAL_DB_BACKUP_PATH"
      break
    fi

    echo "=========================================="
    echo "RESTAURANDO BASE LOCAL"
    echo "=========================================="
    echo "Dump: $LOCAL_DB_BACKUP_PATH"
    echo "DB  : ${POSTGRES_DB:-authorization_local}"
    echo

    "${DC[@]}" up -d postgres

    echo "Esperando PostgreSQL..."
    until "${DC[@]}" exec -T postgres \
      pg_isready \
      -U "${POSTGRES_USER:-authorization}" \
      -d postgres >/dev/null 2>&1
    do
      sleep 2
    done

    echo "Validando compatibilidad del dump..."

    if ! "${DC[@]}" exec -T postgres \
      pg_restore --list \
      >/dev/null \
      < "$LOCAL_DB_BACKUP_PATH"
    then
      echo "ERROR: el pg_restore del contenedor no puede leer este dump."
      break
    fi

    echo "Recreando base local..."

    "${DC[@]}" exec -T postgres \
      dropdb \
      --if-exists \
      --force \
      -U "${POSTGRES_USER:-authorization}" \
      "${POSTGRES_DB:-authorization_local}"

    "${DC[@]}" exec -T postgres \
      createdb \
      -U "${POSTGRES_USER:-authorization}" \
      "${POSTGRES_DB:-authorization_local}"

    echo "Restaurando dump..."

    "${DC[@]}" exec -T postgres \
      pg_restore \
      -U "${POSTGRES_USER:-authorization}" \
      -d "${POSTGRES_DB:-authorization_local}" \
      --no-owner \
      --no-privileges \
      --exit-on-error \
      < "$LOCAL_DB_BACKUP_PATH"

    echo
    echo "RESTORE_DB=PASS"
    echo
    echo "Aplicando migraciones posteriores al dump..."

    "${DC[@]}" build api
    "${DC[@]}" run --rm migrate

    echo
    echo "Levantando aplicación completa..."

    bash "$0" up
    ;;


  db)
    "${DC[@]}" exec postgres \
      sh -lc \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    ;;


  *)
    echo "Uso:"
    echo
    echo "  ./scripts/local.sh up"
    echo "  ./scripts/local.sh down"
    echo "  ./scripts/local.sh restart"
    echo "  ./scripts/local.sh rebuild"
    echo "  ./scripts/local.sh reset"
    echo "  ./scripts/local.sh status"
    echo "  ./scripts/local.sh logs"
    echo "  ./scripts/local.sh logs api"
    echo "  ./scripts/local.sh db"
    echo "  ./scripts/local.sh doctor"
    echo "  ./scripts/local.sh config"
    ;;

esac
