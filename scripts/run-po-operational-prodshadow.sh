#!/usr/bin/env bash

cd "/c/Users/Juan Diaz/AppData/Local/Temp/mtd-ui-operational-redesign"

export DATABASE_URL="postgresql://authorization:authorization@127.0.0.1:15432/authorization_ui_prodshadow"
export API_URL="${API_URL:-http://localhost:3001}"

echo "=================================================="
echo "PO OPERATIONAL E2E — PRODSHADOW"
echo "=================================================="
echo "DATABASE=authorization_ui_prodshadow"
echo "API_URL=$API_URL"
echo "INTEGRATION_SETUP=NO"
echo "DB_RESET=NO"
echo "DOCKER_DOWN=NO"
echo ""

node -e '
const u = new URL(process.env.DATABASE_URL);
if (u.pathname !== "/authorization_ui_prodshadow") {
  console.error("SAFETY_STOP: DATABASE_URL is not prodshadow");
  process.exit(1);
}
console.log("DATABASE_GUARD=PASS");
'

GUARD_RC=$?
echo "DATABASE_GUARD_RC=$GUARD_RC"

if [ "$GUARD_RC" -eq 0 ]; then
  echo ""
  echo "1. API HEALTH"
  curl -sS -o /tmp/po-e2e-health.json -w "HTTP_STATUS=%{http_code}\n" \
    "$API_URL/api/v1/health"
  cat /tmp/po-e2e-health.json
  echo ""

  echo ""
  echo "2. EJECUTAR SOLO EL GATE OPERACIONAL"
  pnpm exec vitest run \
    tests/integration/po-operational-cycle.prodshadow.test.ts \
    --config tests/vitest.integration.config.ts \
    --reporter=verbose

  TEST_RC=$?
  echo ""
  echo "PO_OPERATIONAL_E2E_RC=$TEST_RC"
else
  echo "PO_OPERATIONAL_E2E_RC=NOT_RUN"
fi

echo ""
echo "=================================================="
echo "FIN"
echo "=================================================="
echo "SOURCE_DATABASE_WRITTEN=NO"
echo "DB_RESET_PERFORMED=NO"
echo "DOCKER_VOLUME_REMOVED=NO"
echo "COMMIT_PERFORMED=NO"
