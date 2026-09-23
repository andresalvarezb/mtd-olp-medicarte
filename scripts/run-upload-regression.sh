#!/usr/bin/env bash

echo "============================================================"
echo "UPLOAD REGRESSION GATE"
echo "============================================================"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
BRANCH="$(git branch --show-current 2>/dev/null)"

echo "ROOT=$ROOT"
echo "BRANCH=$BRANCH"

WORKTREE_OK="NO"

if [ "$ROOT" = "/c/Users/Juan Diaz/AppData/Local/Temp/mtd-ui-operational-redesign" ] || \
   [ "$ROOT" = "C:/Users/Juan Diaz/AppData/Local/Temp/mtd-ui-operational-redesign" ]; then
  WORKTREE_OK="YES"
fi

echo "EXPECTED_WORKTREE=$WORKTREE_OK"


echo ""
echo "============================================================"
echo "1. BUILD / TYPECHECK"
echo "============================================================"

pnpm --filter @authorization/contracts build
CONTRACTS_BUILD_RC=$?

pnpm --filter @authorization/database build
DATABASE_BUILD_RC=$?

pnpm --filter @authorization/domain build
DOMAIN_BUILD_RC=$?

pnpm --filter @authorization/api typecheck
API_TYPE_RC=$?

pnpm --filter @authorization/api build
API_BUILD_RC=$?

pnpm --filter @authorization/web typecheck
WEB_TYPE_RC=$?

pnpm --filter @authorization/worker typecheck
WORKER_TYPE_RC=$?


echo ""
echo "============================================================"
echo "2. AUTORIZACIONES"
echo "============================================================"

pnpm --filter @authorization/api exec vitest run \
  src/bulk-imports/bulk-import-xlsx.test.ts \
  src/bulk-imports/bulk-import.service.test.ts

AUTH_UPLOAD_RC=$?


echo ""
echo "============================================================"
echo "3. ANEXO TARIFARIO"
echo "============================================================"

pnpm --filter @authorization/api exec vitest run \
  src/tariff-annex/tariff-annex-xlsx.test.ts \
  src/tariff-annex/tariff-annex.service.test.ts \
  src/tariff-annex/tariff-annex.repository.test.ts

AT_UPLOAD_RC=$?


echo ""
echo "============================================================"
echo "4. DISPONIBILIDAD"
echo "============================================================"

pnpm --filter @authorization/api exec vitest run \
  src/inventory/inventory-availability-xlsx.test.ts

AVAILABILITY_UPLOAD_RC=$?


echo ""
echo "============================================================"
echo "5. ORDEN DE COMPRA XLSX"
echo "============================================================"

pnpm --filter @authorization/api exec vitest run \
  src/purchase-orders/purchase-order-import.service.test.ts

OC_UPLOAD_RC=$?


echo ""
echo "============================================================"
echo "6. DISPENSACION XLSX"
echo "============================================================"

pnpm --filter @authorization/api exec vitest run \
  src/dispensation-import/dispensation-import.service.test.ts

DISPENSATION_UPLOAD_RC=$?


echo ""
echo "============================================================"
echo "7. ENTREGA / APLICACION CORE"
echo "============================================================"

pnpm --filter @authorization/domain exec vitest run \
  src/authorization-fulfillment.test.ts

FULFILLMENT_CORE_RC=$?


echo ""
echo "============================================================"
echo "7B. ENTREGA / APLICACION XLSX"
echo "============================================================"

pnpm --filter @authorization/api exec vitest run \
  src/fulfillments/authorization-fulfillment-import.service.test.ts

FULFILLMENT_UPLOAD_RC=$?


echo ""
echo "============================================================"
echo "8. BARRERA LEGACY"
echo "============================================================"

pnpm --filter @authorization/domain exec vitest run \
  src/legacy-operational-usage-scan.test.ts

LEGACY_GATE_RC=$?


echo ""
echo "============================================================"
echo "9. SUITES COMPLETAS"
echo "============================================================"

pnpm --filter @authorization/contracts test
CONTRACTS_TEST_RC=$?

pnpm --filter @authorization/domain test
DOMAIN_TEST_RC=$?

pnpm --filter @authorization/api test
API_TEST_RC=$?


echo ""
echo "============================================================"
echo "10. FLUJO OPERATIVO OC EXISTENTE"
echo "============================================================"

PO_E2E_RC=99
PO_E2E_MARKER="NOT_RUN"

if [ -f "scripts/run-po-operational-e2e.sh" ]; then
  PO_LOG=".tmp-upload-po-e2e-$(date +%Y%m%d%H%M%S).log"

  bash scripts/run-po-operational-e2e.sh \
    > "$PO_LOG" \
    2>&1

  PO_E2E_RC=$?

  cat "$PO_LOG"

  if grep -Eq \
    "32/32.*PASS|GLOBAL_RESULT=PASS|PO_OPERATIONAL.*PASS|WAVE.*COMPLETE=YES" \
    "$PO_LOG"
  then
    PO_E2E_MARKER="PASS"
  elif [ "$PO_E2E_RC" -ne 0 ]; then
    PO_E2E_MARKER="FAIL"
  else
    PO_E2E_MARKER="UNKNOWN"
  fi
else
  echo "PO_OPERATIONAL_RUNNER_NOT_FOUND"
fi


echo ""
echo "============================================================"
echo "11. DETECTAR XLSX ENTREGA/APLICACION"
echo "============================================================"

FULFILLMENT_XLSX="NO"

if grep -R -q \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.next \
  -E \
  "CLAVE_AUTORIZACION.*TIPO_DISPENSACION|TIPO_DISPENSACION.*FECHA" \
  apps/api/src \
  apps/web \
  2>/dev/null
then
  FULFILLMENT_XLSX="YES"
fi

echo "FULFILLMENT_XLSX_IMPLEMENTED=$FULFILLMENT_XLSX"


echo ""
echo "============================================================"
echo "12. DIFF"
echo "============================================================"

git diff --check
DIFF_RC=$?


echo ""
echo "============================================================"
echo "RESULTADOS"
echo "============================================================"

to_gate() {
  if [ "$1" -eq 0 ]; then
    printf "PASS"
  else
    printf "FAIL"
  fi
}


echo "AUTORIZACIONES_UPLOAD=$(to_gate "$AUTH_UPLOAD_RC")"
echo "AT_UPLOAD=$(to_gate "$AT_UPLOAD_RC")"
echo "DISPONIBILIDAD_UPLOAD=$(to_gate "$AVAILABILITY_UPLOAD_RC")"
echo "OC_UPLOAD=$(to_gate "$OC_UPLOAD_RC")"
echo "DISPENSATION_UPLOAD=$(to_gate "$DISPENSATION_UPLOAD_RC")"

echo "FULFILLMENT_CORE=$(to_gate "$FULFILLMENT_CORE_RC")"
echo "FULFILLMENT_UPLOAD=$(to_gate "$FULFILLMENT_UPLOAD_RC")"
echo "FULFILLMENT_XLSX_IMPLEMENTED=$FULFILLMENT_XLSX"

echo "LEGACY_GATE=$(to_gate "$LEGACY_GATE_RC")"

echo "CONTRACTS_SUITE=$(to_gate "$CONTRACTS_TEST_RC")"
echo "DOMAIN_SUITE=$(to_gate "$DOMAIN_TEST_RC")"
echo "API_SUITE=$(to_gate "$API_TEST_RC")"

echo "API_TYPECHECK=$(to_gate "$API_TYPE_RC")"
echo "API_BUILD=$(to_gate "$API_BUILD_RC")"
echo "WEB_TYPECHECK=$(to_gate "$WEB_TYPE_RC")"
echo "WORKER_TYPECHECK=$(to_gate "$WORKER_TYPE_RC")"

echo "PO_OPERATIONAL_E2E_RC=$PO_E2E_RC"
echo "PO_OPERATIONAL_E2E_MARKER=$PO_E2E_MARKER"

echo "DIFF_CHECK=$(to_gate "$DIFF_RC")"

echo ""
echo "REAL_DATABASE_WRITTEN=NO"
echo "COMMIT=NO"
echo "PUSH=NO"


GLOBAL="PASS"

for RC in \
  "$CONTRACTS_BUILD_RC" \
  "$DATABASE_BUILD_RC" \
  "$DOMAIN_BUILD_RC" \
  "$API_TYPE_RC" \
  "$API_BUILD_RC" \
  "$WEB_TYPE_RC" \
  "$WORKER_TYPE_RC" \
  "$AUTH_UPLOAD_RC" \
  "$AT_UPLOAD_RC" \
  "$AVAILABILITY_UPLOAD_RC" \
  "$OC_UPLOAD_RC" \
  "$DISPENSATION_UPLOAD_RC" \
  "$FULFILLMENT_CORE_RC" \
  "$FULFILLMENT_UPLOAD_RC" \
  "$LEGACY_GATE_RC" \
  "$CONTRACTS_TEST_RC" \
  "$DOMAIN_TEST_RC" \
  "$API_TEST_RC" \
  "$DIFF_RC"
do
  if [ "$RC" -ne 0 ]; then
    GLOBAL="FAIL"
  fi
done


if [ "$WORKTREE_OK" != "YES" ]; then
  GLOBAL="FAIL"
fi


if [ "$PO_E2E_MARKER" != "PASS" ]; then
  GLOBAL="FAIL"
fi


if [ "$FULFILLMENT_XLSX" != "YES" ]; then
  GLOBAL="BLOCKED_FULFILLMENT_XLSX"
fi


echo ""
echo "UPLOAD_REGRESSION_GLOBAL_RESULT=$GLOBAL"
