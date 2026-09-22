#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

ROOT="$(
  cd "$SCRIPT_DIR/.." &&
  pwd
)"

cd "$ROOT"

SOURCE_DB="authorization_test_integration"
TARGET_DB="authorization_ui_dev"
STAGING_DB="authorization_ui_dev_refresh"
PREVIOUS_DB="authorization_ui_dev_previous"

DUMP_FILE="/tmp/authorization_ui_dev_refresh.dump"

FIRST_MIGRATION="0031_esp001_domain_separation.sql"

COMPOSE=(
  docker compose
  -p mtd-ui-dev
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/docker-compose.dev.yml"
)

fail() {
  echo
  echo "=================================================="
  echo "MIGRACION = ERROR"
  echo "=================================================="
  echo
  echo "$1"
  echo
  echo "SOURCE_DB=$SOURCE_DB [NO MODIFICADA]"
  echo "STAGING_DB=$STAGING_DB [CONSERVADA PARA DIAGNOSTICO]"
  echo
  exit 1
}

trap '
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo
    echo "ERROR_EN_LINEA=$LINENO"
    echo "SOURCE_DB=$SOURCE_DB [NO MODIFICADA]"
    echo "STAGING_DB=$STAGING_DB [NO PROMOVIDA]"
  fi
' EXIT


echo "=================================================="
echo "MIGRAR COPIA DE PRODUCCION AL MODELO ACTUAL"
echo "=================================================="
echo
echo "FUENTE  = $SOURCE_DB"
echo "STAGING = $STAGING_DB"
echo "DESTINO = $TARGET_DB"
echo
echo "Primera migracion nueva:"
echo "  $FIRST_MIGRATION"
echo


# ============================================================
# 0. VALIDAR ARCHIVOS DE MIGRACION
# ============================================================

echo "=================================================="
echo "0. VALIDAR MIGRACIONES"
echo "=================================================="

MIGRATION_DIR="$ROOT/packages/database/migrations"

if [ ! -f "$MIGRATION_DIR/$FIRST_MIGRATION" ]; then
  fail "No existe $FIRST_MIGRATION"
fi

mapfile -t ALL_MIGRATIONS < <(
  find "$MIGRATION_DIR" \
    -maxdepth 1 \
    -type f \
    -name "*.sql" \
    -printf "%f\n" |
  sort
)

MIGRATIONS=()
START_FOUND=false

for migration in "${ALL_MIGRATIONS[@]}"; do
  if [ "$migration" = "$FIRST_MIGRATION" ]; then
    START_FOUND=true
  fi

  if [ "$START_FOUND" = true ]; then
    MIGRATIONS+=("$migration")
  fi
done

if [ "${#MIGRATIONS[@]}" -eq 0 ]; then
  fail "No se encontraron migraciones pendientes."
fi

echo "MIGRATIONS_TO_RUN=${#MIGRATIONS[@]}"
echo

printf '  %s\n' "${MIGRATIONS[@]}"

echo
echo "FIRST=${MIGRATIONS[0]}"
echo "LAST=${MIGRATIONS[$((${#MIGRATIONS[@]} - 1))]}"


# ============================================================
# 0.1 VALIDAR QUE PUEDAN EJECUTARSE EN TRANSACCION
# ============================================================

echo
echo "=================================================="
echo "0.1 VALIDAR SQL TRANSACCIONAL"
echo "=================================================="

NON_TRANSACTIONAL=false

for migration in "${MIGRATIONS[@]}"; do
  file="$MIGRATION_DIR/$migration"

  if grep -Eiq \
    'CREATE[[:space:]]+INDEX[[:space:]]+CONCURRENTLY|REINDEX[[:space:]]+.*CONCURRENTLY|VACUUM|CREATE[[:space:]]+DATABASE|ALTER[[:space:]]+SYSTEM' \
    "$file"
  then
    echo "NON_TRANSACTIONAL=$migration"
    NON_TRANSACTIONAL=true
  fi
done

if [ "$NON_TRANSACTIONAL" = true ]; then
  fail "Hay SQL no transaccional. Debe revisarse antes de continuar."
fi

echo "TRANSACTIONAL_MIGRATIONS=PASS"


# ============================================================
# 1. INFRAESTRUCTURA
# ============================================================

echo
echo "=================================================="
echo "1. POSTGRES"
echo "=================================================="

"${COMPOSE[@]}" \
  up -d \
  --no-build \
  postgres


# ============================================================
# 2. VALIDAR FUENTE
# ============================================================

echo
echo "=================================================="
echo "2. VALIDAR COPIA DE PRODUCCION"
echo "=================================================="

SOURCE_EXISTS="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d postgres \
    -At \
    -c "
      select 1
      from pg_database
      where datname = '${SOURCE_DB}';
    " |
  tr -d '\r'
)"

if [ "$SOURCE_EXISTS" != "1" ]; then
  fail "No existe $SOURCE_DB."
fi

SOURCE_AUTH_COUNT="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$SOURCE_DB" \
    -At \
    -v ON_ERROR_STOP=1 \
    -c "
      select count(*)
      from authorization_items;
    " |
  tr -d '\r'
)"

SOURCE_TARIFF_COUNT="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$SOURCE_DB" \
    -At \
    -v ON_ERROR_STOP=1 \
    -c "
      select count(*)
      from tariff_annex_products;
    " |
  tr -d '\r'
)"

SOURCE_MIGRATION_MAX="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$SOURCE_DB" \
    -At \
    -v ON_ERROR_STOP=1 \
    -c "
      select max(created_at)
      from drizzle.__drizzle_migrations;
    " |
  tr -d '\r'
)"

echo "SOURCE_AUTHORIZATIONS=$SOURCE_AUTH_COUNT"
echo "SOURCE_TARIFF_PRODUCTS=$SOURCE_TARIFF_COUNT"
echo "SOURCE_LAST_MIGRATION=$SOURCE_MIGRATION_MAX"


# ============================================================
# 3. DUMP SOLO LECTURA
# ============================================================

echo
echo "=================================================="
echo "3. CREAR DUMP DE PRODUCCION"
echo "=================================================="

"${COMPOSE[@]}" exec -T postgres \
  sh -lc "
    rm -f '$DUMP_FILE'

    pg_dump \
      -U authorization \
      -Fc \
      -d '$SOURCE_DB' \
      -f '$DUMP_FILE'
  "

echo "SOURCE_DUMP=PASS"


# ============================================================
# 4. RECREAR STAGING
# ============================================================

echo
echo "=================================================="
echo "4. RECREAR STAGING"
echo "=================================================="

"${COMPOSE[@]}" exec -T postgres \
  psql \
  -U authorization \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = '${STAGING_DB}'
      and pid <> pg_backend_pid();
  " >/dev/null

"${COMPOSE[@]}" exec -T postgres \
  dropdb \
  -U authorization \
  --if-exists \
  "$STAGING_DB"

"${COMPOSE[@]}" exec -T postgres \
  createdb \
  -U authorization \
  "$STAGING_DB"

echo "STAGING_CREATED=PASS"


# ============================================================
# 5. RESTAURAR STAGING
# ============================================================

echo
echo "=================================================="
echo "5. RESTAURAR COPIA VIEJA EN STAGING"
echo "=================================================="

"${COMPOSE[@]}" exec -T postgres \
  sh -lc "
    pg_restore \
      -U authorization \
      -d '$STAGING_DB' \
      --no-owner \
      --no-privileges \
      --exit-on-error \
      '$DUMP_FILE'
  "

echo "STAGING_RESTORE=PASS"


# ============================================================
# 6. COMPROBAR IDENTIDAD PRE-MIGRACION
# ============================================================

echo
echo "=================================================="
echo "6. VALIDAR STAGING PRE-MIGRACION"
echo "=================================================="

STAGING_AUTH_BEFORE="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$STAGING_DB" \
    -At \
    -c "
      select count(*)
      from authorization_items;
    " |
  tr -d '\r'
)"

STAGING_TARIFF_BEFORE="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$STAGING_DB" \
    -At \
    -c "
      select count(*)
      from tariff_annex_products;
    " |
  tr -d '\r'
)"

echo "SOURCE_AUTH=$SOURCE_AUTH_COUNT"
echo "STAGING_AUTH=$STAGING_AUTH_BEFORE"

echo "SOURCE_TARIFF=$SOURCE_TARIFF_COUNT"
echo "STAGING_TARIFF=$STAGING_TARIFF_BEFORE"

if [ "$STAGING_AUTH_BEFORE" != "$SOURCE_AUTH_COUNT" ]; then
  fail "El staging no contiene las mismas autorizaciones que producción."
fi

if [ "$STAGING_TARIFF_BEFORE" != "$SOURCE_TARIFF_COUNT" ]; then
  fail "El staging no contiene los mismos productos AT que producción."
fi

echo "PRE_MIGRATION_DATA=PASS"


# ============================================================
# 7. EJECUTAR CADA MIGRACION UNA POR UNA
# ============================================================

echo
echo "=================================================="
echo "7. EJECUTAR MIGRACIONES UNA POR UNA"
echo "=================================================="
echo

PASSED=0

for migration in "${MIGRATIONS[@]}"; do
  file="$MIGRATION_DIR/$migration"

  echo "--------------------------------------------------"
  echo "MIGRATION=$migration"
  echo "--------------------------------------------------"

  if "${COMPOSE[@]}" exec -T postgres \
      psql \
      -U authorization \
      -d "$STAGING_DB" \
      -v ON_ERROR_STOP=1 \
      --single-transaction \
      < "$file"
  then
    PASSED=$((PASSED + 1))

    echo
    echo "RESULT=PASS"
    echo "PASSED=$PASSED/${#MIGRATIONS[@]}"
    echo
  else
    echo
    echo "RESULT=FAIL"
    echo "FAILED_MIGRATION=$migration"
    echo "PASSED_BEFORE_FAILURE=$PASSED"
    echo

    fail "La migración $migration falló."
  fi
done

echo
echo "ALL_SQL_MIGRATIONS=PASS"
echo "TOTAL=${#MIGRATIONS[@]}"


# ============================================================
# 8. SINCRONIZAR LEDGER DRIZZLE
#
# Las migraciones YA SE EJECUTARON físicamente.
# Aquí solo registramos ese hecho para que db:migrate no trate
# de ejecutarlas nuevamente.
# ============================================================

echo
echo "=================================================="
echo "8. SINCRONIZAR HISTORIAL DRIZZLE"
echo "=================================================="

LEDGER_SQL="$ROOT/.tmp-ui-dev-migration-ledger.sql"

MIGRATION_DIR="$MIGRATION_DIR" \
FIRST_MIGRATION="$FIRST_MIGRATION" \
python - <<'PY' > "$LEDGER_SQL"
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


migration_dir = Path(
    os.environ["MIGRATION_DIR"]
)

first = os.environ[
    "FIRST_MIGRATION"
]

journal_path = (
    migration_dir
    / "meta"
    / "_journal.json"
)

journal = json.loads(
    journal_path.read_text(
        encoding="utf-8",
    )
)

entries = {
    f'{entry["tag"]}.sql':
        entry
    for entry in journal["entries"]
}

files = sorted(
    p
    for p in migration_dir.glob("*.sql")
)

started = False
selected = []

for p in files:
    if p.name == first:
        started = True

    if started:
        selected.append(p)

if not selected:
    raise SystemExit(
        "No se encontraron migraciones "
        "para ledger."
    )

print("BEGIN;")
print()

for p in selected:
    entry = entries.get(
        p.name
    )

    if entry is None:
        raise SystemExit(
            f"Migration sin journal: {p.name}"
        )

    digest = hashlib.sha256(
        p.read_bytes()
    ).hexdigest()

    created_at = int(
        entry["when"]
    )

    print(
        "INSERT INTO "
        "drizzle.__drizzle_migrations "
        "(hash, created_at) "
        "SELECT "
        f"'{digest}', "
        f"{created_at} "
        "WHERE NOT EXISTS ("
        "SELECT 1 "
        "FROM drizzle.__drizzle_migrations "
        f"WHERE hash = '{digest}'"
        ");"
    )

print()
print("COMMIT;")
PY

"${COMPOSE[@]}" exec -T postgres \
  psql \
  -U authorization \
  -d "$STAGING_DB" \
  -v ON_ERROR_STOP=1 \
  < "$LEDGER_SQL"

rm -f "$LEDGER_SQL"

echo "DRIZZLE_LEDGER=PASS"


# ============================================================
# 9. VALIDACION DE ESQUEMA ACTUAL
# ============================================================

echo
echo "=================================================="
echo "9. VALIDAR MODELO ACTUAL"
echo "=================================================="

"${COMPOSE[@]}" exec -T postgres \
  psql \
  -U authorization \
  -d "$STAGING_DB" \
  -v ON_ERROR_STOP=1 \
  -P pager=off \
  -c "
    select
      to_regclass('public.demand_sources')
        as demand_sources,

      to_regclass('public.planning_periods')
        as planning_periods,

      to_regclass('public.purchase_orders')
        as purchase_orders,

      to_regclass('public.dispensing_points')
        as dispensing_points,

      to_regclass(
        'public.product_delivery_point_mappings'
      )
        as product_delivery_point_mappings;
  "

REQUIRED_TABLES="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$STAGING_DB" \
    -At \
    -c "
      select count(*)
      from (
        values
          ('demand_sources'),
          ('planning_periods'),
          ('purchase_orders'),
          ('dispensing_points'),
          ('product_delivery_point_mappings')
      ) as required(name)
      where to_regclass(
        'public.' || required.name
      ) is not null;
    " |
  tr -d '\r'
)"

if [ "$REQUIRED_TABLES" != "5" ]; then
  fail "No quedaron todas las tablas del modelo actual."
fi

echo "CURRENT_SCHEMA=PASS"


# ============================================================
# 10. VALIDAR DATOS DESPUES DE TODAS LAS MIGRACIONES
# ============================================================

echo
echo "=================================================="
echo "10. VALIDAR DATOS POST-MIGRACION"
echo "=================================================="

STAGING_AUTH_AFTER="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$STAGING_DB" \
    -At \
    -c "
      select count(*)
      from authorization_items;
    " |
  tr -d '\r'
)"

STAGING_TARIFF_AFTER="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$STAGING_DB" \
    -At \
    -c "
      select count(*)
      from tariff_annex_products;
    " |
  tr -d '\r'
)"

echo "AUTH_SOURCE=$SOURCE_AUTH_COUNT"
echo "AUTH_AFTER=$STAGING_AUTH_AFTER"

echo "TARIFF_SOURCE=$SOURCE_TARIFF_COUNT"
echo "TARIFF_AFTER=$STAGING_TARIFF_AFTER"

if [ "$STAGING_AUTH_AFTER" != "$SOURCE_AUTH_COUNT" ]; then
  fail "Cambió la cantidad de autorizaciones."
fi

if [ "$STAGING_TARIFF_AFTER" != "$SOURCE_TARIFF_COUNT" ]; then
  fail "Cambió la cantidad de productos AT."
fi

echo "POST_MIGRATION_DATA=PASS"


# ============================================================
# 11. VALIDAR QUE DB:MIGRATE YA NO TENGA TRABAJO PENDIENTE
# ============================================================

echo
echo "=================================================="
echo "11. VALIDAR DRIZZLE"
echo "=================================================="

DATABASE_URL="postgresql://authorization:authorization@127.0.0.1:15432/${STAGING_DB}" \
  pnpm db:migrate

echo "DRIZZLE_VALIDATION=PASS"


# ============================================================
# 12. COMPROBAR QUE LA FUENTE SIGUE INTACTA
# ============================================================

echo
echo "=================================================="
echo "12. VALIDAR ESPEJO DE PRODUCCION INTACTO"
echo "=================================================="

SOURCE_AUTH_AFTER="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$SOURCE_DB" \
    -At \
    -c "
      select count(*)
      from authorization_items;
    " |
  tr -d '\r'
)"

SOURCE_MIGRATION_AFTER="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d "$SOURCE_DB" \
    -At \
    -c "
      select max(created_at)
      from drizzle.__drizzle_migrations;
    " |
  tr -d '\r'
)"

echo "AUTH_BEFORE=$SOURCE_AUTH_COUNT"
echo "AUTH_AFTER=$SOURCE_AUTH_AFTER"

echo "MIGRATION_BEFORE=$SOURCE_MIGRATION_MAX"
echo "MIGRATION_AFTER=$SOURCE_MIGRATION_AFTER"

if [ "$SOURCE_AUTH_AFTER" != "$SOURCE_AUTH_COUNT" ]; then
  fail "La fuente cambió inesperadamente."
fi

if [ "$SOURCE_MIGRATION_AFTER" != "$SOURCE_MIGRATION_MAX" ]; then
  fail "El historial de la fuente cambió inesperadamente."
fi

echo "PRODUCTION_MIRROR_UNCHANGED=PASS"


# ============================================================
# 13. SWAP
# ============================================================

echo
echo "=================================================="
echo "13. PROMOVER STAGING A UI DEV"
echo "=================================================="

"${COMPOSE[@]}" exec -T postgres \
  psql \
  -U authorization \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname in (
      '${TARGET_DB}',
      '${PREVIOUS_DB}',
      '${STAGING_DB}'
    )
      and pid <> pg_backend_pid();
  " >/dev/null

"${COMPOSE[@]}" exec -T postgres \
  dropdb \
  -U authorization \
  --if-exists \
  "$PREVIOUS_DB"

TARGET_EXISTS="$(
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d postgres \
    -At \
    -c "
      select 1
      from pg_database
      where datname = '${TARGET_DB}';
    " |
  tr -d '\r'
)"

if [ "$TARGET_EXISTS" = "1" ]; then
  "${COMPOSE[@]}" exec -T postgres \
    psql \
    -U authorization \
    -d postgres \
    -v ON_ERROR_STOP=1 \
    -c "
      alter database ${TARGET_DB}
      rename to ${PREVIOUS_DB};
    "

  echo "ROLLBACK_DB=$PREVIOUS_DB"
fi

"${COMPOSE[@]}" exec -T postgres \
  psql \
  -U authorization \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "
    alter database ${STAGING_DB}
    rename to ${TARGET_DB};
  "

echo "ACTIVE_DB=$TARGET_DB"


# ============================================================
# 14. VALIDACION FINAL
# ============================================================

echo
echo "=================================================="
echo "14. RESULTADO FINAL"
echo "=================================================="

"${COMPOSE[@]}" exec -T postgres \
  psql \
  -U authorization \
  -d "$TARGET_DB" \
  -P pager=off \
  -v ON_ERROR_STOP=1 \
  -c "
    select
      current_database()
        as database,

      (
        select count(*)
        from authorization_items
      )
        as autorizaciones,

      (
        select count(*)
        from tariff_annex_products
      )
        as productos_at,

      (
        select count(*)
        from purchase_orders
      )
        as ordenes_compra,

      (
        select count(*)
        from dispensing_points
      )
        as puntos,

      (
        select count(*)
        from product_delivery_point_mappings
      )
        as mapeos_punto;
  "

"${COMPOSE[@]}" exec -T postgres \
  sh -lc "
    rm -f '$DUMP_FILE'
  "

echo
echo "=================================================="
echo "MIGRACION COMPLETA = PASS"
echo "=================================================="
echo
echo "FUENTE:"
echo "  $SOURCE_DB"
echo "  INTACTA"
echo
echo "BASE LOCAL ACTIVA:"
echo "  $TARGET_DB"
echo
echo "ROLLBACK:"
echo "  $PREVIOUS_DB"
echo
echo "SIGUIENTE:"
echo "  ./scripts/dev-local.sh"
echo

trap - EXIT
