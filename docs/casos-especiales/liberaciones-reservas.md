# CE-08 a CE-13 — Vencimientos, liberaciones y reservas

**Advertencia de política:** `runInventoryExpirationReleaseSweep` **NO ejecuta una liberación automática**. El nombre histórico del módulo no representa lo que hace hoy. Fuente de verdad: `apps/worker/src/inventory-expiration-release.ts`.

## CE-08 — Una autorización alcanza `EXPIRED`

El valor de vigencia es una **clasificación temporal informativa**: no elimina ni devuelve `inventory_authorization_allocations`, no aumenta `released_quantity`, no desvincula AUTO→OC, no aplica automáticamente una prohibición de atención o reasignación (esas operaciones mantienen sus controles individuales). El cálculo del horizonte de consulta usa el día calendario **America/Bogota** y un horizonte de 30 días para la proyección de consulta (`authorization-query-validity.ts`).

**Proceso worker:** con `SCHEDULER_ENABLED=true`, al iniciar y cada **5 minutos** ejecuta `runInventoryExpirationReleaseSweep`. Utiliza `pg_try_advisory_xact_lock`; genera `outbox_events` `realtime.invalidate` para `AUTHORIZATIONS` y `DASHBOARD` en organizaciones activas MTD y MEDICARTE. La clave idempotente incorpora día y organización, evitando repetición por el mismo día. Los cuatro contadores de mutación de inventario permanecen **0** por diseño vigente.

**No interpretar** `EXPIRED -> stock disponible`. No registrar en informes unidades liberadas por caducidad si no hay hecho distinto (anulación, edición, reasignación o consumo).

## CE-09 — Anular autorización sin atención confirmada

**Endpoint:** `POST /api/v1/authorizations/:id/annul`; **organización:** MTD; **permiso:** `authorizations.manual_edit`.

```json
{"expectedVersion": 3, "reason": "Anulación solicitada por corrección operacional"}
```

La razón debe contener entre 5 y 1000 caracteres. El servicio bloquea la AUTO con `FOR UPDATE`, valida versión y comprueba evidencia positiva de entregas, aplicaciones confirmadas o consumo en allocations. **Cualquier atención confirmada bloquea la anulación**, aun si la cantidad atendida fue parcial. Si no hay consumo, libera reservas físicas restantes, marca las referencias `purchase_order_authorization_sources` como liberadas (`released_at`/`released_by`), conserva las OC y registra evidencia de anulación y evento `AUTHORIZATION_ANNULLED`.

Los compromisos liberados **no eliminan la historia comercial de la OC**. Anular no implica crear, recibir o despachar inventario. Ver también [BR-AUTO-ANNUL-001](../requirements/BR-AUTO-ANNUL-001-anulacion-autorizacion.md).

## CE-10 — Cambio de producto con saldo reservado

Solo sin atención confirmada. Se libera **todo saldo activo no consumido** de la AUTO; las existencias recibidas continúan vinculadas a su ledger/origen de recepción y disponibilidad física respectiva. No se fabrica stock para el producto nuevo. Una OC de OLP o ya recibida no se transforma retrospectivamente al nuevo producto.

## CE-11 — Reducción de cantidad con saldo reservado

Se libera solo el excedente: `exceso = max(reservaActiva - max(cantidadNueva - consumoConfirmado, 0), 0)`. Se actualiza `released_quantity` y el estado de allocation sin disminuir cantidades consumidas. Una cantidad menor que el consumo se rechaza.

## CE-12 — Reasignación explícita de OC/AUTO

El importador de OC distingue `CREAR_OC`, `ASIGNAR_DISPONIBLE` y `REASIGNAR` por existencia de OC y presencia de origen; no debe confundirse reasignar asociación histórica con crear un lote de medicamento. Se exige identidad de producto y reglas de cantidades/cobertura/estado. Las reasignaciones que implican stock deben ser transaccionales y verificadas ante recepción, aplicación previa y concurrencia; ver [guía MTD](../flujo-mtd.md) y [ADR-043](../adr/043-authorization-order-receipt-fulfillment-reassignment.md).

## CE-13 — Reconciliación de asignaciones tras recepción

La recepción directa Medicarte (`POST /api/v1/medicarte/purchase-orders/:id/receipts`) confirma **cantidad físicamente recibida** y realiza una conciliación de asignaciones a las autorizaciones elegibles en el contexto de esa OC. Existe `POST /api/v1/medicarte/purchase-orders/:id/reconcile-allocations` para conciliar. `POST /api/v1/admin/purchase-orders/reconcile-received-allocations` es **administrativo** y exige foundation admin, destinado a reparación de evidencia histórica; **no** es la operación normal de recepción. No mezclar recepción directa por OC con flujo legado de `deliveries` en la misma OC.

## Matriz de comparación

| Evento | Cambia reserva | Cambia OC histórica | Incrementa inventario físico | Dispara invalidación |
| --- | --- | --- | --- | --- |
| Día de vencimiento | **No** | No | No | Sí, vistas AUTO/dashboard |
| Anulación sin atención | Sí, libera saldo | Conserva OC, marca fuente liberada | No | Sí |
| Cambio de producto | Sí, libera no consumido | Solo reconcilia OC exclusivamente MTD elegible | No | Sí |
| Reducción de cantidad | Sí, solo exceso | Solo en caso MTD elegible | No | Sí |
| Aumento de cantidad | No crea nuevas reservas | Sujeto a caso MTD elegible | No | Sí |
| Recepción real | Puede reconciliar allocations | Conserva trazabilidad OC | Registra recepción operacional real; distinguir ledger directo/legado | Sí |

**Por certificar:** pruebas de concurrencia anulación vs fulfillment, recepción parcial repetida, límites de disponibilidad por punto, replay del worker y reconciliación histórica; jamás llamar PASS por lectura estática.
