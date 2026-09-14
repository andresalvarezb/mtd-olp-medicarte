# ADR-036 — ESP-013 Indicadores operacionales y económicos

Estado: accepted  
Fecha: 2026-09-14

## Contexto

MTD necesita un tablero operacional y económico derivado de los hechos ya persistidos en ESP-001…ESP-012. El tablero no es un ERP, no es contabilidad y no es una fuente de verdad adicional.

PostgreSQL sigue siendo la fuente de verdad. Las métricas se calculan en un read model de solo lectura.

## Decisión

1. Analytics no persiste totales, saldos ni márgenes. No hay columnas `total_applied`, `current_inventory`, `total_revenue` ni `profit`.
2. Las fórmulas viven en `@authorization/domain` (`operational-analytics`) y la API/UI las reutilizan. Las consultas SQL solo agregan hechos; las tasas y el dinero se componen con esas funciones.
3. ESP-013 es MTD-only. Medicarte, OLP y Compensar no reciben el dashboard.
4. No hay tablas de negocio nuevas. La migración `0044_esp013_analytics.sql` solo añade permisos e índices justificados por las consultas analíticas.
5. No hay exportación XLSX en ESP-013: la infraestructura XLSX existente es de importación de programación, no de tablero. Queda para ESP-014.
6. No hay auto-consolidación de demanda ni costing engine (FIFO, promedio ponderado, reserva de stock).

## Semántica de documentos de compra

`effectivePurchaseCoverage` y `requestedQuantity` no son la misma métrica y no se etiquetan igual.

| Estado OC                                                                                                                | `requestedQuantity`                     | `acceptedQuantity`               | `effectivePurchaseCoverage` (ESP-005)                  |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| DRAFT                                                                                                                    | no cuenta (no emitida)                  | no cuenta                        | sí: `allocated_quantity` (reserva de cupo de demanda)  |
| ISSUED / UNDER_OLP_REVIEW                                                                                                | cuenta                                  | 0 si `accepted_quantity` es null | `allocated_quantity`                                   |
| ACCEPTED / PARTIALLY_ACCEPTED / IN_FULFILLMENT / PARTIALLY_DISPATCHED / FULLY_DISPATCHED / PARTIALLY_RECEIVED / RECEIVED | cuenta                                  | `accepted_quantity`              | `accepted_quantity`                                    |
| REJECTED                                                                                                                 | cuenta (histórico de solicitud emitida) | 0                                | 0                                                      |
| CANCELLED                                                                                                                | no cuenta                               | no cuenta                        | 0                                                      |

- `effectivePurchaseCoverage` = demanda ya asignada o bloqueada para compra, **incluyendo asignaciones DRAFT** según ESP-005. No es “comprado”.
- `requestedQuantity` = cantidad realmente solicitada en OC emitidas/relevantes. **Excluye DRAFT.**

`requestedQuantity` y `acceptedQuantity` nunca se sustituyen entre sí. La fórmula de cobertura ESP-005 no cambia en ESP-013.

## Métricas de cantidad

### Demanda — `projected_demand_lines`

- `regularProjectedQuantity` = SUM(`regular_quantity`)
- `lateProjectedQuantity` = SUM(`late_quantity`)
- `projectedQuantity` = regular + late (invariante ESP-004)
- `lastConsolidatedAt` = MAX(`consolidated_at`)
- `stale` = true si hay `patient_schedules` SCHEDULED/RESCHEDULED del recorte cuya revisión no está en `demand_sources`, o fuentes cuya revisión ya no coincide / el schedule fue CANCELLED.

La proyección es la última consolidación materializada, no un live query de schedules. ESP-013 no reconsolida.

### Compra — `purchase_order_lines` de OC relevantes

- `requestedQuantity` = SUM(`requested_quantity`) según la tabla de estados (excluye DRAFT)
- `acceptedQuantity` = SUM(COALESCE(`accepted_quantity`, 0)) según la tabla de estados
- `supplierShortageQuantity` = max(requested − accepted, 0)
- `effectivePurchaseCoverage` = fórmula ESP-005 (incluye asignaciones DRAFT; no es cantidad solicitada ni “comprado”)
- `procurementGapQuantity` = max(projected − effectivePurchaseCoverage, 0)

### Entrega — `delivery_lines` de deliveries `DISPATCHED` o `RECEIVED`

DRAFT y CANCELLED no cuentan.

- `dispatchedQuantity` = SUM(`quantity`)
- `deliveryPendingQuantity` = max(accepted − dispatched, 0)
- `dispatchFulfillmentRate` = dispatched / accepted si accepted > 0; si no, rate = null

### Recepción — `receipt_lines` de receipts `CONFIRMED`

DRAFT no cuenta. No se llama “received” a lo aceptado a inventario.

- `physicallyReceivedQuantity` = SUM(`received_quantity`)
- `acceptedIntoInventoryQuantity` = SUM(`accepted_quantity`)
- `rejectedQuantity` = SUM(`rejected_quantity`)
- `receiptPhysicalShortageQuantity` = SUM(`shortage_quantity`)
- `receiptAcceptanceRate` = acceptedIntoInventory / physicallyReceived si physicallyReceived > 0; si no, null

### Aplicación — `patient_application_lines` de applications `CONFIRMED`

No se infiere desde schedule ni outcome.

- `appliedQuantity` = SUM(`quantity`)
- `applicationRate` = applied / projected si projected > 0; el denominador es la última proyección materializada del recorte, no necesariamente comparable unidad a unidad con el flujo de inventario.

### No aplicación — `patient_schedule_outcomes`

Novelty no es un estado.

- `notAppliedCount` = COUNT(\*) de outcomes del recorte
- distribución por `noveltyCode` (catálogo ESP-011)
- `terminalOperationalResultCount` = confirmed applications en el recorte + outcomes en el recorte
- `noShowRate` = COUNT(PATIENT_NO_SHOW) / `terminalOperationalResultCount` si el denominador > 0

El denominador no es “todos los pacientes” ni schedules abiertos sin resultado.

### NON_REUSABLE — `inventory_movements`

- `nonReusableQuantity` = SUM(ABS(`quantity_delta`)) WHERE `movement_type` = 'NON_REUSABLE'
- REUSABLE no genera movimiento y no se suma

### Inventario actual — ledger ESP-008/009

No es inventario del período.

- `currentOnHandQuantity` = SUM(`quantity_delta`) de `inventory_movements` (saldo físico actual)
- `usableBalance` = saldo físico de lotes con `expiration_date >= current_date`; vencidos aportan 0
- `inTransitQuantity` = SUM(`stock_transfer_lines.quantity`) de traslados `DISPATCHED`
- `expiredPhysicalQuantity` / `upcomingExpirationQuantity` (≤ 30 días, regla ESP-008)

Prohibido llamar a `currentOnHandQuantity` “sobrante del período”.

`receivedMinusAppliedFlow` = acceptedIntoInventory − applied. Es un indicador de flujo del período, no inventario atribuible al período.

Carry-over: el ledger no se reinicia al cambiar de período. Las aplicaciones pueden consumir unidades recibidas antes. Los traslados mueven ubicación sin crear ni destruir cantidad controlada.

## Tasas

Todas las tasas devuelven `{ numerator, denominator, rate }`.

- denominador 0 → `rate = null` (N/A). Nunca 0% inventado.
- `rate` es string decimal de 4 cifras (`0.7500`), calculado con truncamiento entero.
- Cantidades enteras. El dinero no usa `Number`.

## Auditoría — read model ESP-012

- `readyForAudit`: applications CONFIRMED sin fila de auditoría y sin outcome de la misma revisión
- `inReview` / `approved` / `rejected`: filas de `patient_application_audits`
- `approvedApplicationsCount` = COUNT de auditorías APPROVED (conteo de aplicaciones, no cantidad aplicada)
- REJECTED de auditoría ≠ NOT_APPLIED operacional

## Economía

Dos familias que nunca se mezclan ni se llaman `price`. Cada métrica económica expone `{ availability, value, reason, basis }`.

- `availability`: `EXACT` o `UNAVAILABLE`. `value` es null cuando UNAVAILABLE.
- `basis`: `PURCHASE_ORDER_SNAPSHOT` \| `PERIOD_EFFECTIVE_TARIFF` \| null.
- `reason` cuando UNAVAILABLE, entre otros: `HISTORICAL_TARIFF_UNAVAILABLE`, `INCOMPLETE_TARIFF_LOOKUP`, `INCOMPLETE_SUPPLIER_COST`, `AMBIGUOUS_LOT_PROVENANCE`, `NO_QUANTITY`, `INCOMPARABLE_LINEAGE`.

### A. COMPENSAR → MTD (tarifa)

**La tarifa activa actual no es tarifa histórica.** `tariff_annex_products.active = true` no basta, por sí solo, para afirmar que esa tarifa es la efectiva del período consultado. ESP-013 no inventa versionado histórico de tarifas.

- `projectedTariffReferenceValue` es EXACT solo si existe **tarifa autoritativa efectiva para el producto y el período/fecha analizada** (`basis = PERIOD_EFFECTIVE_TARIFF`). Ese lineage de vigencia no existe hoy en el modelo; por tanto el valor proyectado queda UNAVAILABLE con `reason = HISTORICAL_TARIFF_UNAVAILABLE` y `basis = null`. No se usa el anexo activo vigente como sustituto silencioso, ni en períodos históricos ni por el mero hecho de estar marcado como activo.
- `requestedTariffSnapshotValue` / `acceptedTariffSnapshotValue`: cantidad × `compensar_unit_rate_snapshot` de la línea de OC (`basis = PURCHASE_ORDER_SNAPSHOT`). El snapshot de la OC permanece autoritativo **para los hechos de esa OC**. No se usa como tarifa proyectada del período. Si falta snapshot en alguna línea del recorte: UNAVAILABLE / `INCOMPLETE_TARIFF_LOOKUP`.

Una proyección histórica que solo tenga la tarifa activa actual **no se calcula**.

### B. OLP → MTD (costo proveedor)

- `requestedSupplierValue` / `acceptedSupplierValue`: cantidad × `supplier_unit_cost` de la línea de OC (`basis = PURCHASE_ORDER_SNAPSHOT`), solo si **todas** las líneas relevantes tienen costo.
- `dispatchedSupplierValue`: `delivery_lines.quantity` × `supplier_unit_cost` de su `purchase_order_line`.
- `acceptedReceiptSupplierValue`: `receipt_lines.accepted_quantity` × `supplier_unit_cost` de la PO line vía delivery line.

Si el recorte no tiene filas, o alguna fila carece de costo, el agregado es UNAVAILABLE (`value = null`, `reason = INCOMPLETE_SUPPLIER_COST` o `NO_QUANTITY`). No se muestra `0.00` como si fuera un valor real.

### Costo aplicado — prohibido fabricarlo

`appliedSupplierCost` es siempre UNAVAILABLE con razón `AMBIGUOUS_LOT_PROVENANCE`. Un lote puede mezclar receipts/POs y los traslados mueven inventario. No hay cost-layer. ESP-013 no introduce FIFO ni promedio ponderado.

### Diferencia tarifaria

`grossOperationalSpreadReference` = accepted tariff snapshot − accepted supplier value, solo si ambos son EXACT y comparables sobre el mismo recorte de OC aceptadas.

No es utilidad neta, no es margen oficial, no incluye todos los costos, no es contabilidad.

## Dinero

Representación JSON: string decimal con 2 cifras (`12.50`), igual que `compensar_unit_rate_snapshot` y `supplier_unit_cost`. Aritmética con enteros (centavos) o `numeric` de PostgreSQL. Una sola moneda implícita del anexo tarifario; no hay multi-currency.

## Freshness

Cada respuesta incluye `generatedAt`, `planningPeriodId`, `demandLastConsolidatedAt` y `projectedDemandStale`. Una proyección stale no se presenta como live.

## Filtros

`planningPeriodId`, `dispensingPointId`, `commercialCode`, `orderType`, `demandBucket`, `dateFrom`/`dateTo`, `operationalStatus`, `noveltyCode`, `auditStatus`.

- Demanda y compra son de período, no de rango de fechas.
- El rango de fechas aplica a `application_date`, `occurred_on`, `dispatched_at::date` y `received_at::date`.
- Inventario actual no se recorta por fecha.
- `operationalStatus` recorta aplicación vs outcomes, no el funnel logístico.
- `auditStatus` recorta solo la sección de auditoría.
- Los agregados económicos no incluyen paciente ni documento.

## RBAC

| Permiso                    | Roles                                                          |
| -------------------------- | -------------------------------------------------------------- |
| `analytics.read`           | MTD_ADMIN, MTD_OPERATOR, MTD_GENERAL, MTD_AUDITORIA, READ_ONLY |
| `analytics.economics.read` | los mismos                                                     |

READ_ONLY en MTD ya tiene lectura completa de módulos MTD; se le otorga economía. MEDICARTE_OPERATOR, OLP_OPERATOR y COMPENSAR_VIEWER no tienen ninguno de los dos.

Los endpoints analytics son GET. No mutan hechos operacionales.

## API

- `GET /analytics/operational` — tablero compuesto
- `GET /analytics/novelties`
- `GET /analytics/inventory`
- `GET /analytics/economics` — requiere `analytics.economics.read`
- `GET /analytics/drilldown?kind=` projected \| ordered \| accepted \| dispatched \| received \| applied \| not_applied \| audit

`economics` en el payload operacional es null si el perfil no tiene `analytics.economics.read`.

## UI

Módulo **Indicadores** (`/indicadores`). Funnel visible completo: proyectado → solicitado a OLP → aceptado OLP → despachado → recibido físico → aceptado a inventario → aplicado. `effectivePurchaseCoverage` se etiqueta **Cobertura/asignación de compra**, nunca “Comprado”. `requestedQuantity` se etiqueta **Solicitado a OLP**. Economía en dos columnas (COMPENSAR / OLP). Inventario etiquetado como stock actual. Métricas UNAVAILABLE se muestran “No disponible”.

## Consecuencias

- Gate A: PostgreSQL limpio hasta ESP-013 (migración 0044).
- Gate B: upgrade exacto ESP-012 → ESP-013.
- Residual: valoración de inventario y costo aplicado exacto requieren una especificación futura de cost-layer. Una tarifa proyectada EXACT para el período consultado requiere lineage de vigencia tarifaria (no inventado en ESP-013). Export XLSX queda en ESP-014.
