# Evidencia inicial: flujo

- `.agent/adr/ADR-032-esp-008-inventory-ledger.md`: decisión sobre ledger e inventario recibido.
- `apps/api/src/fulfillments/authorization-fulfillment-inventory-mode.ts`: selección `DIRECT_RECEIPT` / `LOT_LEDGER`.
- `apps/api/src/fulfillments/authorization-fulfillment.repository.ts`: asignación y consumo por modo.
- `apps/api/src/receipts/receipt.repository.ts`: confirmación, recepción directa, límites y proyecciones.
- `apps/api/src/receipts/receipt-purchase-order-allocation.test.ts`
- `apps/api/src/fulfillments/authorization-fulfillment-inventory-mode.test.ts`
- `apps/api/src/purchase-orders/purchase-order-import-direct.service.test.ts`

Buscar además consumidores y contratos del símbolo modificado con `rg`; esta lista no reemplaza el análisis de impacto.
