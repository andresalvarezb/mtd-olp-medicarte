# Recepciones parciales, diferencias, lotes y no conformidades

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

## Dos vías distintas de recepción

**A. Recepción por entrega de OLP (`/api/v1/medicarte/receipts`):** crea borrador desde una `delivery` despachada, permite editar líneas y confirma. Guarda cantidades `received/accepted/rejected`, lote y vencimiento recibidos, motivo de no conformidad y observación.

**B. Recepción directa de OC (`POST /api/v1/medicarte/purchase-orders/:id/receipts`):** el contrato solicita `purchaseOrderLineId`, `receivedQuantity > 0`, `receivedAt` y observación opcional. **No solicita lote ni fecha de vencimiento física**, y su asignación automática a AUTO usa pool OC+producto+punto, no lotes físicos. No presentar esa recepción como control farmacéutico de lotes.

| ID | Caso | Comportamiento observado | Estado |
| --- | --- | --- | --- |
| CE-49 | Entrega despachada llega incompleta | Capturar `receivedQuantity` inferior a despachada; pendiente remanente preservado por acumulación | IMPLEMENTADO EN FUENTE |
| CE-50 | Aceptación parcial con rechazo | Exigir `accepted + rejected = received`, sin valores negativos ni cantidades sobre recibido | IMPLEMENTADO EN FUENTE |
| CE-51 | Unidades rechazadas por daño o empaque | Motivos `DAMAGED_PRODUCT` y `PACKAGING_ISSUE`; la confirmación registra no conformidad, no una devolución física posrecepción | IMPLEMENTADO EN FUENTE |
| CE-52 | Lote distinto al esperado o fecha distinta | Comparar lote/vencimiento; registrar `LOT_MISMATCH` / `EXPIRATION_MISMATCH` y observaciones cuando aplique | IMPLEMENTADO EN FUENTE |
| CE-53 | Aceptar sin lote/vencimiento o producto vencido | Rechazo `RECEIPT_LOT_EXPIRATION_REQUIRED` / `RECEIPT_EXPIRED_PRODUCT` en recepción por entrega | IMPLEMENTADO EN FUENTE |
| CE-54 | Dos recepciones de una misma entrega | Control acumulado para impedir superar cantidad despachada (`RECEIPT_OVER_RECEIVED`); entrega puede seguir `DISPATCHED` hasta completar | IMPLEMENTADO EN FUENTE |
| CE-55 | Recepción directa parcial de OC | Estado `RECEIVED_PARTIAL` o `RECEIVED_COMPLETE` en contrato; autoasignación por pool, con prioridad de AUTO y asignación completa o ninguna | IMPLEMENTADO EN FUENTE |
| CE-56 | Corregir recepción ya confirmada | Edición normal solo en `DRAFT` (`RECEIPT_FROZEN`); corrección confirmada requiere operación específica aprobada, no editar filas | PARCIAL / REQUIERE DECISIÓN |

## Conciliación al recibir

- Conservar cuatro medidas por línea: despachado, recibido, aceptado y rechazado; `shortage = despachado − recibido` no debe confundirse con rechazo de unidades físicamente recibidas.
- Validar recepción y lote antes de hacer disponibles unidades por el flujo legacy.
- En recepción directa por OC, distinguir **pools recibidos** de **asignaciones por autorización**: la asignación automática puede quedar pendiente si la AUTO no puede cubrirse por completo.
- Nunca sumes una recepción de OC directa con la representación legacy de la misma operación sin verificar la procedencia; el repositorio implementa una reconciliación específica.

## Evidencia de rechazo y pendientes

Guardar evidencia de remisión, fotos, lote, vencimiento, cantidades por línea, observación, transportador/proveedor y acciones correctivas. **No se verificó un endpoint general para devolución de mercancía ya recibida**; consultar [devoluciones y pérdidas](devoluciones-mermas-productos.md).

**Código verificado:** `apps/api/src/receipts/receipt.{controller,repository}.ts`, `packages/domain/src/receipt.ts`, `packages/contracts/src/index.ts` (schemas `receiptLineRequest`, `purchaseOrderDirectReceiptRequest`), ADR-043.
