# Evidencia inicial: flujo

- `.agent/adr/ADR-032-esp-008-inventory-ledger.md`: decisión sobre ledger e inventario recibido.
- `apps/api/src/fulfillments/authorization-fulfillment-inventory-mode.ts`: selección `DIRECT_RECEIPT` / `LOT_LEDGER`.
- `apps/api/src/fulfillments/authorization-fulfillment.repository.ts`: asignación y consumo por modo.
- `apps/api/src/receipts/receipt.repository.ts`: confirmación, recepción directa, límites y proyecciones.
- `apps/api/src/receipts/receipt-purchase-order-allocation.test.ts`
- `apps/api/src/fulfillments/authorization-fulfillment-inventory-mode.test.ts`
- `apps/api/src/purchase-orders/purchase-order-import-direct.service.test.ts`
- `docs/requirements/BR-AUTO-DISP-001-asignacion-automatica-disponibilidad.md`: asignación automática y no duplicación.
- `docs/requirements/BR-AUTO-EXP-001-gracia-continuidad-atencion.md`: vigencia y continuidad de reservas.
- `apps/api/src/inventory/inventory-availability.repository.ts`: reserva física y asignación.
- `apps/api/src/inventory/inventory-availability-auto-planner.test.ts`: prioridad, stock y reintentos.

## Casos condicionales

- Imports de OC: revisar `purchase-order-import.service.ts`, controller y pruebas `purchase-order-import-*.test.ts`; comprobar identidad, reintentos y enlaces a autorizaciones.
- Imports de consumo: revisar `authorization-fulfillment-import.service.ts` y su prueba; confirmar que importar no invente recepción o inventario.
- Conciliaciones: revisar `apps/api/src/reconciliation/` y separar diagnóstico, reparación, idempotencia y registro de auditoría.

Buscar consumidores y contratos con `rg -n "<símbolo>" apps packages tests`. Ejecutar `pnpm.cmd test:focused -- apps/api/src/ruta/archivo.test.ts` en PowerShell y typecheck si cambian contratos. Esta lista orienta; no reemplaza el análisis de impacto.
