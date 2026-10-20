# AC-FIN-001 — Capacidad de compra de OC después de una anulación

**Fecha:** 2026-10-20
**Implementación:** PR #91, integrado en develop
**Estado:** Implementado en código; certificación operativa pendiente.

## Objetivo

Permitir que MTD reutilice la capacidad de compra disponible en una orden
de compra existente cuando una autorización anterior se haya anulado sin
entregas ni aplicaciones confirmadas.

La operación debe conservar la trazabilidad histórica y distinguir
inventario físico de compromisos de compra aún no recibidos.

## 1. Reglas de negocio

1. Una AUTO con cualquier cantidad entregada o aplicada no puede anularse.
2. La anulación libera las reservas no consumidas y las fuentes activas.
3. Las fuentes históricas permanecen registradas mediante released_at
   y released_by.
4. La OC conserva su identidad, cantidades solicitadas y recepciones.
5. La anulación no genera medicamentos disponibles físicamente.
6. Una nueva AUTO puede aprovechar un compromiso de compra pendiente
   cuando tiene producto, punto, vigencia y cobertura compatibles.
7. No se puede superar la capacidad disponible de la OC, punto o línea.
8. No se puede recrear una pareja histórica de línea OC y AUTO liberada.

## 2. Diferencia entre cantidades

| Concepto | Interpretación |
| --- | --- |
| Solicitado | Cantidad comprada en la OC |
| Recibido | Cantidad físicamente recibida |
| Asignado | Cantidad físicamente reservada |
| Disponible sin asignar | Stock físico utilizable |
| Pendiente de recepción | Compra todavía no recibida |
| Compromiso OC activo | Cobertura lógica vigente |
| Saldo OC pendiente sin comprometer | Compra futura reutilizable |
| Liberado por anulación histórico | Evidencia de cantidades liberadas |

El histórico liberado no constituye stock ni debe sumarse como capacidad
adicional a las cantidades pendientes o recibidas.

## 3. Importación de OC

La plantilla PURCHASE_ORDERS_V3 utiliza:

CLAVE_AUTORIZACION_ORIGEN, CLAVE_AUTORIZACION_DESTINO,
OC, CODIGO_PRODUCTO, CANTIDAD.

### OC nueva y AUTO_ORIGEN vacía

Se crea la OC y se registra la autorización como fuente de compra.

### OC existente y AUTO_ORIGEN vacía

Primero se comprueba la disponibilidad física.

Si alcanza para la cantidad completa, se reserva inventario físico
mediante ASSIGN_AVAILABLE.

Si no alcanza, se evalúa el compromiso de compra todavía pendiente
mediante ASSIGN_PENDING_COMMITMENT.

La fila es indivisible: no se distribuye automáticamente entre stock
recibido y compra futura.

### OC existente y AUTO_ORIGEN informada

Se conserva la reasignación REASSIGN con contrato 1:1, controles de
producto, cantidades, estados y ausencia de consumo.

Esta operación no debe confundirse con ASSIGN_PENDING_COMMITMENT.

## 4. Cálculo de capacidad

Saldo conceptual de compra sin comprometer:

saldo = max(0, solicitado - max(recibido, compromiso_activo))

Adicionalmente se aplican restricciones por:

- Orden de compra.
- Código comercial.
- Punto de dispensación.
- Línea individual de compra.
- Cantidades ya planificadas en la transacción.
- Relaciones históricas previamente liberadas.

Una cantidad inválida, negativa, no entera o una línea sin identidad
válida deben rechazarse antes de ejecutar la inserción.

## 5. Persistencia

ASSIGN_PENDING_COMMITMENT crea nuevas relaciones activas en
purchase_order_authorization_sources con procedencia
DIRECT_AUTHORIZATION.

No modifica:

- purchase_order_lines.requested_quantity.
- purchase_order_receipts.
- purchase_order_receipt_lines.
- inventory_authorization_allocations.
- Fuentes históricas que ya fueron liberadas.

La operación es transaccional y debe respetar los bloqueos
de OC y producto.

## 6. Auditoría

Evento:

PURCHASE_ORDER_PENDING_COMMITMENT_ASSIGNED

Debe registrar la OC, producto, cantidad, AUTO destino, punto
y evidenciar que no fueron modificadas las cantidades de compra,
las recepciones ni las reservas físicas.

## 7. Interfaz y exportación

El módulo /inventario/disponibilidad y el XLSX deben presentar
por separado:

- COMPROMISO_OC_ACTIVO
- SALDO_OC_PENDIENTE_SIN_COMPROMETER
- LIBERADO_ANULACION_HISTORICO

También conservan cantidades solicitadas, recibidas,
asignadas, atendidas y pendientes de recepción.

## 8. Ejemplos operativos

Caso A: OC 10 sin recepción, AUTO anterior anulada sin consumo.
Nueva AUTO solicita 6. Puede vincularse compromiso futuro 6,
sujeto a compatibilidad y capacidad; no se crean 6 existencias físicas.

Caso B: OC 10, recibidas 6. La existencia útil se asigna
físicamente cuando alcanza la cantidad completa. La capacidad de
compra no recibida se gestiona por separado.

Caso C: AUTO que ya estuvo asociada a una línea liberada.
No se recrea la misma relación histórica línea/AUTO.

Caso D: AUTO con consumo 1. La anulación debe rechazarse.

## 9. Validación

Pruebas automatizadas de referencia:

- purchase-order-import-pending.service.test.ts
- purchase-order-import-existing.service.test.ts
- purchase-order-import-rules.service.test.ts
- inventory-availability-balance.test.ts
- inventory-availability-xlsx.test.ts

Antes de certificar el cierre se requiere:

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build
- Integración con PostgreSQL real.
- Pruebas de concurrencia.
- Validación HTTP con los roles operativos.
- Validación del XLSX y de las cantidades por OC/punto.

La integración del PR #91 en develop no demuestra, por sí sola,
que el cambio esté desplegado en producción.

## 10. Referencias

- docs/requirements/BR-AUTO-ANNUL-001-anulacion-autorizacion.md
- docs/adr/043-authorization-order-receipt-fulfillment-reassignment.md
- docs/flujo-mtd.md
- docs/casos-especiales/liberaciones-reservas.md
- apps/api/src/purchase-orders/purchase-order-import.service.ts
- apps/api/src/inventory/inventory-availability.repository.ts
- apps/api/src/inventory/inventory-availability.service.ts

PR de implementación:
https://github.com/andresalvarezb/mtd-olp-medicarte/pull/91
