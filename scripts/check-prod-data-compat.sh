#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
  pwd
)"

cd "$ROOT"

SOURCE_DB="authorization_test_integration"
TARGET_DB="authorization_ui_dev"

COMPOSE=(
  docker compose
  -p mtd-ui-dev
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/docker-compose.dev.yml"
)

echo "=================================================="
echo "COMPATIBILIDAD DATOS PRODUCCION -> UI DEV"
echo "=================================================="

"${COMPOSE[@]}" up -d --no-build postgres >/dev/null

"${COMPOSE[@]}" exec -T postgres sh -lc "
set -e

SOURCE_DB='${SOURCE_DB}'
TARGET_DB='${TARGET_DB}'

echo
echo '=================================================='
echo '1. CONTEOS'
echo '=================================================='

for DB in \"\$SOURCE_DB\" \"\$TARGET_DB\"
do
  echo
  echo \"DATABASE=\$DB\"

  psql \
    -U authorization \
    -d \"\$DB\" \
    -At \
    -c \"
      select
        'authorization_items=' ||
        count(*)
      from authorization_items;
    \"

  psql \
    -U authorization \
    -d \"\$DB\" \
    -At \
    -c \"
      select
        'tariff_annex_products=' ||
        count(*)
      from tariff_annex_products;
    \"
done

echo
echo '=================================================='
echo '2. TABLAS FUENTE QUE NO EXISTEN EN TARGET'
echo '=================================================='

psql \
  -U authorization \
  -d \"\$SOURCE_DB\" \
  -At \
  -c \"
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name;
  \" \
  > /tmp/source_tables.txt

psql \
  -U authorization \
  -d \"\$TARGET_DB\" \
  -At \
  -c \"
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name;
  \" \
  > /tmp/target_tables.txt

comm -23 \
  /tmp/source_tables.txt \
  /tmp/target_tables.txt \
  || true

echo
echo '=================================================='
echo '3. TABLAS NUEVAS SOLO EN UI DEV'
echo '=================================================='

comm -13 \
  /tmp/source_tables.txt \
  /tmp/target_tables.txt \
  || true

echo
echo '=================================================='
echo '4. COLUMNAS OBLIGATORIAS NUEVAS'
echo '   QUE PRODUCCION NO PODRIA SUMINISTRAR'
echo '=================================================='

psql \
  -U authorization \
  -d \"\$SOURCE_DB\" \
  -At \
  -F '|' \
  -c \"
    select
      table_name,
      column_name
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position;
  \" \
  > /tmp/source_columns.txt

psql \
  -U authorization \
  -d \"\$TARGET_DB\" \
  -At \
  -F '|' \
  -c \"
    select
      c.table_name,
      c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.is_nullable = 'NO'
      and c.column_default is null
      and c.identity_generation is null
      and exists (
        select 1
        from information_schema.tables st
        where st.table_schema = 'public'
          and st.table_name = c.table_name
      )
    order by
      c.table_name,
      c.ordinal_position;
  \" \
  > /tmp/target_required_columns.txt

sort -u \
  /tmp/source_columns.txt \
  -o /tmp/source_columns.txt

sort -u \
  /tmp/target_required_columns.txt \
  -o /tmp/target_required_columns.txt

comm -23 \
  /tmp/target_required_columns.txt \
  /tmp/source_columns.txt \
  || true

echo
echo '=================================================='
echo '5. COLUMNAS CRITICAS - AUTORIZACIONES'
echo '=================================================='

echo
echo '--- PRODUCCION ---'

psql \
  -U authorization \
  -d \"\$SOURCE_DB\" \
  -P pager=off \
  -c \"
    select
      column_name,
      data_type,
      is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'authorization_items'
    order by ordinal_position;
  \"

echo
echo '--- UI DEV ---'

psql \
  -U authorization \
  -d \"\$TARGET_DB\" \
  -P pager=off \
  -c \"
    select
      column_name,
      data_type,
      is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'authorization_items'
    order by ordinal_position;
  \"

echo
echo '=================================================='
echo 'COMPATIBILITY_CHECK=PASS'
echo '=================================================='
"
