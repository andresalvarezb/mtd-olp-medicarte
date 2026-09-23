#!/usr/bin/env bash

ROOT="/c/Users/Juan Diaz/AppData/Local/Temp/mtd-ui-operational-redesign"

cd "$ROOT"

RUN_ID="$(date +%Y%m%d%H%M%S)"

BASE_DATABASE="authorization_prod_220926_migrated"

E2E_DATABASE="authorization_e2e_${RUN_ID}"

E2E_DATABASE_URL="postgresql://authorization:authorization@127.0.0.1:15432/${E2E_DATABASE}"

E2E_REDIS_DB="15"

E2E_PORT="8017"

E2E_API_URL="http://127.0.0.1:${E2E_PORT}"

E2E_ADMIN_USERNAME="foundation-admin"
E2E_ADMIN_PASSWORD="E2E-${RUN_ID}-Admin!"


E2E_LOG=".tmp-e2e-api-${RUN_ID}.log"

E2E_HEALTH=".tmp-e2e-health-${RUN_ID}.json"

COMPOSE_ARGS=(
  -p mtd-ui-dev
  -f docker-compose.yml
  -f docker-compose.dev.yml
)

PG_CID="$(
  docker compose \
    "${COMPOSE_ARGS[@]}" \
    ps -q postgres \
    2>/dev/null
)"

REDIS_CID="$(
  docker compose \
    "${COMPOSE_ARGS[@]}" \
    ps -q redis \
    2>/dev/null
)"

API_PID=""

INFRA_RC=0
WEB_RC=1
API_RC=1
API_BUILD_RC=1
REDIS_PRE_CLEAN_RC=1
DUMP_RC=1
CREATE_DB_RC=1
RESTORE_RC=1
CLONE_RC=1
MIGRATE_E2E_RC=1
AUTH_FIXTURE_RC=1
API_READY=0
E2E_RC=1
DROP_E2E_DB_RC=1
REDIS_CLEAN_RC=1
REDIS_KEYS_REMAINING="-1"
E2E_DATABASE_REMAINING="-1"
TARGET_CLEAN_RC=1
DIFF_RC=1

TARGET_BEFORE=""
TARGET_AFTER=""

DUMP_PATH="/tmp/${E2E_DATABASE}.dump"


echo "=================================================="
echo "PO OPERATIONAL E2E — EPHEMERAL"
echo "=================================================="
echo "RUN_ID=$RUN_ID"
echo "BASE_DATABASE=$BASE_DATABASE"
echo "EPHEMERAL_DATABASE=$E2E_DATABASE"
echo "API_URL=$E2E_API_URL"
echo "REDIS_DB=$E2E_REDIS_DB"
echo "PG_CID=$PG_CID"
echo "REDIS_CID=$REDIS_CID"
echo "COMMIT=NO"
echo "PUSH=NO"
echo ""


# ============================================================
# 0. INFRA
# ============================================================

echo "=================================================="
echo "0. INFRA"
echo "=================================================="

if [ -z "$PG_CID" ]; then
  echo "POSTGRES_CONTAINER=NOT_FOUND"
  INFRA_RC=1
else
  echo "POSTGRES_CONTAINER=OK"
fi

if [ -z "$REDIS_CID" ]; then
  echo "REDIS_CONTAINER=NOT_FOUND"
  INFRA_RC=1
else
  echo "REDIS_CONTAINER=OK"
fi

if \
  [ -n "$PG_CID" ] && \
  [ -n "$REDIS_CID" ]
then
  INFRA_RC=0
fi

echo "INFRA_RC=$INFRA_RC"


# ============================================================
# 1. TYPECHECK WEB
# ============================================================

echo ""
echo "=================================================="
echo "1. TYPECHECK WEB"
echo "=================================================="

pnpm --filter @authorization/web typecheck
WEB_RC=$?

echo "WEB_RC=$WEB_RC"


# ============================================================
# 2. TYPECHECK / BUILD API
# ============================================================

echo ""
echo "=================================================="
echo "2. TYPECHECK / BUILD API"
echo "=================================================="

pnpm --filter @authorization/api typecheck
API_RC=$?

pnpm --filter @authorization/api build
API_BUILD_RC=$?

echo "API_RC=$API_RC"
echo "API_BUILD_RC=$API_BUILD_RC"


# ============================================================
# 3. SNAPSHOT READ-ONLY DEL TARGET
# ============================================================

echo ""
echo "=================================================="
echo "3. SNAPSHOT BASE REAL"
echo "=================================================="

if [ "$INFRA_RC" -eq 0 ]; then
  TARGET_BEFORE="$(
    docker exec \
      "$PG_CID" \
      psql \
      -U authorization \
      -d "$BASE_DATABASE" \
      -Atc "
        select
          (select count(*) from planning_periods)::text || '|' ||
          (select count(*) from dispensing_points)::text || '|' ||
          (select count(*) from tariff_annex_products)::text || '|' ||
          (select count(*) from projected_demand_lines)::text || '|' ||
          (select count(*) from purchase_orders)::text || '|' ||
          (select count(*) from deliveries)::text || '|' ||
          (select count(*) from receipts)::text || '|' ||
          (select count(*) from inventory_movements)::text;
      " \
      2>/dev/null
  )"

  echo "TARGET_BEFORE=$TARGET_BEFORE"
fi


# ============================================================
# 4. LIMPIAR SOLO REDIS DB 15
# ============================================================

echo ""
echo "=================================================="
echo "4. LIMPIAR REDIS E2E"
echo "=================================================="

if [ "$INFRA_RC" -eq 0 ]; then
  docker exec \
    "$REDIS_CID" \
    redis-cli \
    -n "$E2E_REDIS_DB" \
    FLUSHDB

  REDIS_PRE_CLEAN_RC=$?
fi

echo "REDIS_PRE_CLEAN_RC=$REDIS_PRE_CLEAN_RC"


# ============================================================
# 5. CLONAR BASE MIGRADA
# ============================================================

echo ""
echo "=================================================="
echo "5. CREAR BASE E2E EFIMERA"
echo "=================================================="

if [ "$INFRA_RC" -eq 0 ]; then

  MSYS_NO_PATHCONV=1 \
  docker exec \
    "$PG_CID" \
    rm -f \
    "$DUMP_PATH"

  MSYS_NO_PATHCONV=1 \
  docker exec \
    "$PG_CID" \
    pg_dump \
    -U authorization \
    -Fc \
    -d "$BASE_DATABASE" \
    -f "$DUMP_PATH"

  DUMP_RC=$?

  echo "DUMP_RC=$DUMP_RC"


  docker exec \
    "$PG_CID" \
    dropdb \
    -U authorization \
    --if-exists \
    "$E2E_DATABASE"

  DROP_BEFORE_CREATE_RC=$?

  echo "DROP_BEFORE_CREATE_RC=$DROP_BEFORE_CREATE_RC"


  if [ "$DROP_BEFORE_CREATE_RC" -eq 0 ]; then
    docker exec \
      "$PG_CID" \
      createdb \
      -U authorization \
      "$E2E_DATABASE"

    CREATE_DB_RC=$?
  else
    CREATE_DB_RC=1
  fi

  echo "CREATE_DB_RC=$CREATE_DB_RC"


  if \
    [ "$DUMP_RC" -eq 0 ] && \
    [ "$CREATE_DB_RC" -eq 0 ]
  then
    MSYS_NO_PATHCONV=1 \
    docker exec \
      "$PG_CID" \
      pg_restore \
      -U authorization \
      --exit-on-error \
      --no-owner \
      --no-privileges \
      -d "$E2E_DATABASE" \
      "$DUMP_PATH"

    RESTORE_RC=$?
  else
    RESTORE_RC=1
  fi

  echo "RESTORE_RC=$RESTORE_RC"


  if \
    [ "$DUMP_RC" -eq 0 ] && \
    [ "$CREATE_DB_RC" -eq 0 ] && \
    [ "$RESTORE_RC" -eq 0 ]
  then
    CLONE_RC=0
  fi
fi

echo "CLONE_RC=$CLONE_RC"

echo ""
echo "=================================================="
echo "5B. MIGRAR BASE E2E EFIMERA"
echo "=================================================="

if [ "$CLONE_RC" -eq 0 ]; then

  DATABASE_URL="$E2E_DATABASE_URL" \
  pnpm db:migrate

  MIGRATE_E2E_RC=$?

  if [ "$MIGRATE_E2E_RC" -ne 0 ]; then
    CLONE_RC=1
  fi
fi

echo "MIGRATE_E2E_RC=$MIGRATE_E2E_RC"



# ============================================================
# 6. GUARD DB EFIMERA
# ============================================================

echo ""
echo "=================================================="
echo "6. GUARD BASE E2E"
echo "=================================================="

if [ "$CLONE_RC" -eq 0 ]; then

  CURRENT_DB="$(
    docker exec \
      "$PG_CID" \
      psql \
      -U authorization \
      -d "$E2E_DATABASE" \
      -Atc \
      "select current_database();" \
      2>/dev/null
  )"

  echo "CURRENT_DB=$CURRENT_DB"

  case "$CURRENT_DB" in
    authorization_e2e_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9])
      DB_GUARD_RC=0
      ;;
    *)
      DB_GUARD_RC=1
      ;;
  esac
else
  DB_GUARD_RC=1
fi

echo "DB_GUARD_RC=$DB_GUARD_RC"


# ============================================================
# 6B. PREPARAR CREDENCIAL ADMIN E2E
# ============================================================

echo ""
echo "=================================================="
echo "6B. PREPARAR CREDENCIAL ADMIN E2E"
echo "=================================================="

FOUNDATION_ADMIN_ROWS="0"

if [ "$DB_GUARD_RC" -eq 0 ]; then

  FOUNDATION_ADMIN_ROWS="$(
    docker exec \
      "$PG_CID" \
      psql \
      -U authorization \
      -d "$E2E_DATABASE" \
      -Atc "
        select count(*)
          from users
         where lower(username)='foundation-admin';
      " \
      2>/dev/null
  )"

  echo "FOUNDATION_ADMIN_ROWS=$FOUNDATION_ADMIN_ROWS"

  if [ "$FOUNDATION_ADMIN_ROWS" = "1" ]; then

    docker exec \
      "$PG_CID" \
      psql \
      -U authorization \
      -d "$E2E_DATABASE" \
      -v ON_ERROR_STOP=1 \
      -c "
        update users
           set password_hash = null,
               must_change_password = false,
               updated_at = now()
         where id in (
           select distinct u.id
             from users u
             join user_organization_roles uor
               on uor.user_id = u.id
              and uor.active = true
             join roles r
               on r.id = uor.role_id
             join organizations o
               on o.id = uor.organization_id
            where r.code = 'MTD_ADMIN'
              and o.code = 'MTD'
         );
      " \
      >/dev/null

    AUTH_FIXTURE_RC=$?
  fi
fi

echo "AUTH_FIXTURE_RC=$AUTH_FIXTURE_RC"


# ============================================================
# 7. LEVANTAR API AISLADA
# ============================================================

echo ""
echo "=================================================="
echo "7. LEVANTAR API AISLADA"
echo "=================================================="

rm -f \
  "$E2E_LOG" \
  "$E2E_HEALTH"

if \
  [ "$DB_GUARD_RC" -eq 0 ] && \
  [ "$AUTH_FIXTURE_RC" -eq 0 ] && \
  [ "$API_BUILD_RC" -eq 0 ]
then

  (
    cd apps/api &&
    DATABASE_URL="$E2E_DATABASE_URL" \
    REDIS_URL="redis://127.0.0.1:6379/${E2E_REDIS_DB}" \
    AUTH_JWT_SECRET="0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0" \
    AUTH_BOOTSTRAP_ADMIN_USERNAME="$E2E_ADMIN_USERNAME" \
    AUTH_BOOTSTRAP_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" \
    API_PUBLIC_URL="$E2E_API_URL" \
    WEB_ORIGIN="http://localhost:3002" \
    API_PORT="$E2E_PORT" \
    PORT="$E2E_PORT" \
    NODE_ENV="development" \
    IMPORT_MAX_FILE_BYTES="20971520" \
    IMPORT_PROCESSOR_VERSION="2" \
    node dist/main.js
  ) > "$E2E_LOG" 2>&1 &

  API_PID=$!

  echo "E2E_API_PID=$API_PID"


  for ATTEMPT in $(seq 1 60)
  do
    rm -f "$E2E_HEALTH"

    HTTP_STATUS="$(
      curl \
        -sS \
        -o "$E2E_HEALTH" \
        -w "%{http_code}" \
        "$E2E_API_URL/api/v1/health" \
        2>/dev/null
    )"

    if [ "$HTTP_STATUS" = "200" ]; then
      API_READY=1
      break
    fi

    sleep 0.5
  done
fi

echo "API_READY=$API_READY"

if [ "$API_READY" -eq 1 ]; then
  cat "$E2E_HEALTH"
  echo ""
else
  echo "API_HEALTH=FAIL"

  if [ -f "$E2E_LOG" ]; then
    tail -160 "$E2E_LOG"
  fi
fi


# ============================================================
# 8. EJECUTAR E2E
# ============================================================

echo ""
echo "=================================================="
echo "8. EJECUTAR E2E OPERACIONAL"
echo "=================================================="

if [ "$API_READY" -eq 1 ]; then

  DATABASE_URL="$E2E_DATABASE_URL" \
  API_URL="$E2E_API_URL" \
  REDIS_URL="redis://127.0.0.1:6379/${E2E_REDIS_DB}" \
  AUTH_DEV_ADMIN_USERNAME="$E2E_ADMIN_USERNAME" \
  AUTH_DEV_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" \
  pnpm exec vitest run \
    tests/integration/po-operational-cycle.prodshadow.test.ts \
    --config tests/vitest.prodshadow.config.ts \
    --reporter=verbose

  E2E_RC=$?
else
  echo "E2E_NOT_RUN=API_NOT_READY"
  E2E_RC=1
fi

echo "E2E_RC=$E2E_RC"


# ============================================================
# 9. LOG API SI FALLA
# ============================================================

if [ "$E2E_RC" -ne 0 ]; then
  echo ""
  echo "=================================================="
  echo "9. API LOG ULTIMAS 200 LINEAS"
  echo "=================================================="

  if [ -f "$E2E_LOG" ]; then
    tail -200 "$E2E_LOG"
  fi
fi


# ============================================================
# 10. DETENER API
# ============================================================

echo ""
echo "=================================================="
echo "10. DETENER API E2E"
echo "=================================================="

if [ -n "$API_PID" ]; then
  kill "$API_PID" \
    2>/dev/null

  wait "$API_PID" \
    2>/dev/null
fi

echo "E2E_API_STOPPED=YES"


# ============================================================
# 11. ELIMINAR DB EFIMERA
# ============================================================

echo ""
echo "=================================================="
echo "11. ELIMINAR DB E2E"
echo "=================================================="

if [ -n "$PG_CID" ]; then

  docker exec \
    "$PG_CID" \
    psql \
    -U authorization \
    -d postgres \
    -c "
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname='${E2E_DATABASE}'
        and pid <> pg_backend_pid();
    " \
    >/dev/null 2>&1

  TERMINATE_RC=$?

  echo "TERMINATE_RC=$TERMINATE_RC"


  docker exec \
    "$PG_CID" \
    dropdb \
    -U authorization \
    --if-exists \
    "$E2E_DATABASE"

  DROP_E2E_DB_RC=$?

  echo "DROP_E2E_DB_RC=$DROP_E2E_DB_RC"


  MSYS_NO_PATHCONV=1 \
  docker exec \
    "$PG_CID" \
    rm -f \
    "$DUMP_PATH"

  DUMP_CLEAN_RC=$?

  echo "DUMP_CLEAN_RC=$DUMP_CLEAN_RC"
fi


# ============================================================
# 12. LIMPIAR REDIS DB 15
# ============================================================

echo ""
echo "=================================================="
echo "12. LIMPIAR REDIS E2E"
echo "=================================================="

if [ -n "$REDIS_CID" ]; then

  docker exec \
    "$REDIS_CID" \
    redis-cli \
    -n "$E2E_REDIS_DB" \
    FLUSHDB

  REDIS_CLEAN_RC=$?

  REDIS_KEYS_REMAINING="$(
    docker exec \
      "$REDIS_CID" \
      redis-cli \
      -n "$E2E_REDIS_DB" \
      DBSIZE \
      2>/dev/null \
      | tr -d '\r'
  )"
fi

echo "REDIS_CLEAN_RC=$REDIS_CLEAN_RC"
echo "REDIS_KEYS_REMAINING=$REDIS_KEYS_REMAINING"


# ============================================================
# 13. VERIFICAR DB ELIMINADA
# ============================================================

echo ""
echo "=================================================="
echo "13. VERIFICAR DB E2E ELIMINADA"
echo "=================================================="

if [ -n "$PG_CID" ]; then
  E2E_DATABASE_REMAINING="$(
    docker exec \
      "$PG_CID" \
      psql \
      -U authorization \
      -d postgres \
      -Atc \
      "select count(*)
         from pg_database
        where datname='${E2E_DATABASE}';" \
      2>/dev/null
  )"
fi

echo "E2E_DATABASE_REMAINING=$E2E_DATABASE_REMAINING"


# ============================================================
# 14. VERIFICAR BASE REAL NO CAMBIO
# ============================================================

echo ""
echo "=================================================="
echo "14. VERIFICAR BASE REAL"
echo "=================================================="

if [ -n "$PG_CID" ]; then

  TARGET_AFTER="$(
    docker exec \
      "$PG_CID" \
      psql \
      -U authorization \
      -d "$BASE_DATABASE" \
      -Atc "
        select
          (select count(*) from planning_periods)::text || '|' ||
          (select count(*) from dispensing_points)::text || '|' ||
          (select count(*) from tariff_annex_products)::text || '|' ||
          (select count(*) from projected_demand_lines)::text || '|' ||
          (select count(*) from purchase_orders)::text || '|' ||
          (select count(*) from deliveries)::text || '|' ||
          (select count(*) from receipts)::text || '|' ||
          (select count(*) from inventory_movements)::text;
      " \
      2>/dev/null
  )"

  echo "TARGET_BEFORE=$TARGET_BEFORE"
  echo "TARGET_AFTER=$TARGET_AFTER"

  if \
    [ -n "$TARGET_BEFORE" ] && \
    [ "$TARGET_BEFORE" = "$TARGET_AFTER" ]
  then
    TARGET_CLEAN_RC=0
  fi
fi

echo "TARGET_CLEAN_RC=$TARGET_CLEAN_RC"


# ============================================================
# 15. DIFF CHECK
# ============================================================

echo ""
echo "=================================================="
echo "15. DIFF CHECK"
echo "=================================================="

git diff --check
DIFF_RC=$?

echo "DIFF_RC=$DIFF_RC"


# ============================================================
# 16. RESULTADO FINAL
# ============================================================

echo ""
echo "=================================================="
echo "RESULTADO FINAL E2E"
echo "=================================================="

echo "RUN_ID=$RUN_ID"
echo "BASE_DATABASE=$BASE_DATABASE"
echo "EPHEMERAL_DATABASE=$E2E_DATABASE"

echo "INFRA_RC=$INFRA_RC"
echo "WEB_RC=$WEB_RC"
echo "API_RC=$API_RC"
echo "API_BUILD_RC=$API_BUILD_RC"

echo "REDIS_PRE_CLEAN_RC=$REDIS_PRE_CLEAN_RC"

echo "DUMP_RC=$DUMP_RC"
echo "CREATE_DB_RC=$CREATE_DB_RC"
echo "RESTORE_RC=$RESTORE_RC"
echo "CLONE_RC=$CLONE_RC"
echo "MIGRATE_E2E_RC=$MIGRATE_E2E_RC"
echo "AUTH_FIXTURE_RC=$AUTH_FIXTURE_RC"

echo "API_READY=$API_READY"
echo "E2E_RC=$E2E_RC"

echo "DROP_E2E_DB_RC=$DROP_E2E_DB_RC"
echo "E2E_DATABASE_REMAINING=$E2E_DATABASE_REMAINING"

echo "REDIS_CLEAN_RC=$REDIS_CLEAN_RC"
echo "REDIS_KEYS_REMAINING=$REDIS_KEYS_REMAINING"

echo "TARGET_CLEAN_RC=$TARGET_CLEAN_RC"
echo "DIFF_RC=$DIFF_RC"

echo "REAL_DATABASE_OPERATIONAL_DATA_WRITTEN=NO_EXPECTED"
echo "COMMIT_PERFORMED=NO"
echo "PUSH_PERFORMED=NO"

echo ""

if \
  [ "$INFRA_RC" -eq 0 ] && \
  [ "$WEB_RC" -eq 0 ] && \
  [ "$API_RC" -eq 0 ] && \
  [ "$API_BUILD_RC" -eq 0 ] && \
  [ "$REDIS_PRE_CLEAN_RC" -eq 0 ] && \
  [ "$CLONE_RC" -eq 0 ] && \
  [ "$AUTH_FIXTURE_RC" -eq 0 ] && \
  [ "$API_READY" -eq 1 ] && \
  [ "$E2E_RC" -eq 0 ] && \
  [ "$DROP_E2E_DB_RC" -eq 0 ] && \
  [ "$E2E_DATABASE_REMAINING" = "0" ] && \
  [ "$REDIS_CLEAN_RC" -eq 0 ] && \
  [ "$REDIS_KEYS_REMAINING" = "0" ] && \
  [ "$TARGET_CLEAN_RC" -eq 0 ] && \
  [ "$DIFF_RC" -eq 0 ]
then
  echo "E2E_GLOBAL_RESULT=PASS"
  FINAL_RC=0
else
  echo "E2E_GLOBAL_RESULT=FAIL"
  FINAL_RC=1
fi

echo "=================================================="

test "$FINAL_RC" -eq 0
