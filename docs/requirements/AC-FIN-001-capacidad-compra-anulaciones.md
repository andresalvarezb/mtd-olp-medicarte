# AC-FIN-001 — Capacidad pendiente de OC después de una liberación

**Fecha:** 2026-10-20
**Implementación:** PR #91, integrado en develop
**Estado:** La capacidad base corresponde al PR #91; la ampliación por
vencimiento está implementada en la rama de trabajo. Certificación de base de
datos y despliegue pendientes.

**Ampliación 2026-11-04:** el vencimiento libera desde el día 6 solo cuando no
existe atención confirmada; ver [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md).
La migración `0105_purchase_order_source_history`
define el soporte para una nueva fuente activa después de conservar la fuente
liberada; debe aplicarse coordinadamente antes de aceptar escrituras nuevas.

## Objetivo

Permitir que MTD reutilice la capacidad de compra pendiente en una OC existente
cuando la fuente anterior se liberó por anulación o vencimiento. Para una
anulación, esta continúa sujeta a BR-AUTO-ANNUL-001: no puede haber entregas ni
aplicaciones confirmadas. Para vencimiento, una AUTO que se reutiliza como
destino debe tener la vigencia ampliada y cumplir los demás requisitos.

La operación debe conservar la trazabilidad histórica y distinguir
inventario físico de compromisos de compra aún no recibidos.

## 1. Reglas de negocio

1. Una AUTO con cualquier cantidad entregada o aplicada no puede anularse.
2. La anulación libera las reservas no consumidas y las fuentes activas.
3. Desde el día 6 posterior al vencimiento y sin atención confirmada, el worker
   libera el saldo físico pendiente y las fuentes activas de OC con actor
   `SYSTEM`, sin esperar al cierre del mes. Si existe atención confirmada,
   conserva el saldo y el vínculo activo para continuidad. Una recepción
   posterior de esa misma OC activa puede completar progresivamente la reserva
   conforme a BR-AUTO-EXP-001.
4. Las fuentes liberadas permanecen como filas históricas inmutables con su
   cantidad snapshot, fecha y actor de liberación.
5. La OC conserva su identidad, cantidades solicitadas y recepciones.
6. La liberación o revinculación de una fuente no genera inventario físico.
7. MTD puede vincular manualmente una AUTO destino con vigencia válida,
   producto, punto y capacidad pendiente compatibles. Puede ser la misma AUTO
   renovada; el archivo lleva `AUTO_ORIGEN` vacío.
8. Solo puede existir una fuente activa por pareja línea OC–AUTO. Una fuente
   liberada no impide insertar una nueva fila activa con `id` propio.
9. No se puede superar la capacidad pendiente de la OC, punto o línea ni
   recuperar capacidad que ya quedó comprometida a otra AUTO.
10. Los vínculos liberados no se suman como compromisos activos ni se duplican
    en los totales históricos de una misma pareja línea–AUTO.
11. Si el worker encuentra locks tomados por una edición manual, revierte solo
    el caso ocupado y lo reintenta en el siguiente barrido.

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
| Liberado por anulación o vencimiento | Evidencia histórica; no es stock ni compromiso activo |

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
- Relaciones activas de la pareja línea–AUTO; una fila liberada permanece
  como evidencia y no bloquea por sí sola una nueva fila activa.

Una cantidad inválida, negativa, no entera o una línea sin identidad
válida deben rechazarse antes de ejecutar la inserción.

## 5. Persistencia

ASSIGN_PENDING_COMMITMENT crea una fila activa con `id` propio en
`purchase_order_authorization_sources` y procedencia `DIRECT_AUTHORIZATION`.
La clave primaria es ese `id`; un índice único parcial restringe la pareja
`(purchase_order_line_id, authorization_item_id)` mientras `released_at IS NULL`.

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
Si la AUTO fue liberada por vencimiento sin atención y se renovó, MTD puede seleccionarla
con `AUTO_ORIGEN` vacía para una línea pendiente sin recibir, si producto,
punto y capacidad siguen siendo compatibles. Se conserva la fila liberada y
se crea otra fuente activa con `id` distinto. Sin renovación o sin capacidad,
se rechaza. La anulación sigue siendo irreversible y no permite reutilizar la
AUTO anulada.

Caso D: una segunda AUTO ya tiene comprometida la capacidad pendiente.
La AUTO renovada no puede recuperar esa capacidad ni exceder el saldo libre.

Caso E: AUTO con consumo 1. La anulación debe rechazarse.

## 9. Validación

Pruebas automatizadas de referencia:

- purchase-order-import-pending.service.test.ts
- purchase-order-import-existing.service.test.ts
- purchase-order-import-rules.service.test.ts
- apps/worker/src/inventory-expiration-release.test.ts
- tests/integration/inventory-expiration-auto-release.prodshadow.test.ts
- inventory-availability-balance.test.ts
- inventory-availability-xlsx.test.ts

Antes de certificar el cierre se requiere:

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build
- Integración con PostgreSQL real.
- Pruebas de concurrencia.
- Aplicación y despliegue coordinados de `0104` y `0105` antes de reanudar
  escrituras de OC.
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
