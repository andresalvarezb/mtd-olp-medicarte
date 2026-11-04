# CE-08 a CE-13 — Vencimientos, liberaciones y reservas

**Política vigente:** consultar [BR-AUTO-EXP-001](../requirements/BR-AUTO-EXP-001-gracia-continuidad-atencion.md). En Bogotá, la fecha final es inclusiva; los días 1 a 5 permiten atención. Desde el día 6, `runInventoryExpirationReleaseSweep` libera la reserva física pendiente y el vínculo activo OC únicamente si no existe atención confirmada. Con atención confirmada se conserva el saldo restante y el vínculo. Las fuentes y allocations permanecen como historial; no se borran recepciones ni consumos.

## CE-08 — Una autorización alcanza `EXPIRED`

Durante los días calendario 1 a 5 posteriores al vencimiento se permite iniciar o continuar entrega/aplicación, si pasan los demás controles y existe saldo autorizado y reservado. Una recepción real puede crear una reserva durante esa ventana. Desde el día 6, el worker consulta evidencia moderna e histórica: sin atención confirmada libera `allocated_quantity - consumed_quantity - released_quantity` y las fuentes activas AUTO→OC (`released_by_type=SYSTEM`), sin importar si cambió el mes. Con atención confirmada conserva reservas, consumos y fuentes activas. Una recepción física posterior de esa misma OC activa puede crear un top-up, limitado al snapshot de compra aún no comprometido, saldo autorizado sin reservar y pool físico recibido sin asignar. No se reactiva una fuente liberada ni se crea una relación comercial nueva. Mantiene cantidades comerciales, recepciones y consumos; la fuente liberada queda visible como historial.

**Proceso worker:** con SCHEDULER_ENABLED=true, al iniciar y cada **5 minutos** ejecuta runInventoryExpirationReleaseSweep. Usa advisory y row locks, registra auditoría con actor SYSTEM e invalida AUTHORIZATIONS, PURCHASE_ORDERS, INVENTORY y DASHBOARD. Las liberaciones son idempotentes; una segunda ejecución no vuelve a aumentar released_quantity ni crea auditoría duplicada.

**No interpretar** una reserva liberada como existencia nueva. Un producto recibido después de la liberación no se reserva automáticamente para esa fuente. Una atención confirmada no aumenta el autorizado ni el stock; solo protege el saldo existente.

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
| Día 1 a 5 después del vencimiento | Se conserva; recepción real puede crear reserva | Conserva el vínculo activo | Solo recepción real | Sí, vistas AUTO/dashboard |
| Día 6 sin atención confirmada, cualquier mes | Libera el saldo pendiente | Libera fuentes activas y conserva historial | No crea inventario; unidades físicas liberadas vuelven a disponibilidad | Sí |
| Día 6 o posterior con atención confirmada y recepción posterior de la misma OC | Conserva saldo pendiente y permite top-up dentro de los límites autorizados, comprometidos y físicos | Conserva fuente activa | Idempotente: lo recibido y asignado no se reserva otra vez | Sí |
| Día 6 o posterior sin nueva recepción o con autorización completa | Conserva solo saldo existente; no asigna unidades inexistentes o ya atendidas | Conserva fuente activa si existe atención confirmada | Sin top-up | Sí |
| Anulación sin atención | Sí, libera saldo | Conserva OC, marca fuente liberada | No | Sí |
| Cambio de producto | Sí, libera no consumido | Solo reconcilia OC exclusivamente MTD elegible | No | Sí |
| Reducción de cantidad | Sí, solo exceso | Solo en caso MTD elegible | No | Sí |
| Aumento de cantidad | No crea nuevas reservas | Sujeto a caso MTD elegible | No | Sí |
| Recepción real | Puede reconciliar allocations | Conserva trazabilidad OC | Registra recepción operacional real; distinguir ledger directo/legado | Sí |

**Por certificar:** pruebas de concurrencia anulación vs fulfillment, recepción parcial repetida, límites de disponibilidad por punto, replay del worker y reconciliación histórica; jamás llamar PASS por lectura estática.

## CE-12A — Compromisos pendientes después de liberación

Una fuente liberada por anulación o, sin atención confirmada, desde el día 6
por vencimiento se conserva como evidencia histórica. Durante los cinco días
de gracia la reserva puede utilizarse para atención si se cumplen los demás
controles. Una AUTO con atención confirmada después del día 5 mantiene su
reserva existente y vínculo activo; una recepción física posterior de esa
misma OC activa puede completarla progresivamente dentro de los límites
comerciales, autorizados y físicos. La política para crear una relación
comercial nueva después de ese día continúa bloqueada.

El importador de OC existentes permite vincular compra todavía pendiente a una
AUTO destino compatible, sin fabricar inventario. Si la AUTO vencida se renovó,
MTD puede seleccionarla de nuevo con `AUTO_ORIGEN` vacía y la cantidad
pendiente. En la misma línea de OC, se conserva la fuente liberada y se crea
una nueva fuente activa con `id` distinto. Producto, punto, vigencia y
capacidad se vuelven a validar. La renovación no restaura una reserva física
liberada ni recupera capacidad ya comprometida a otra AUTO; la nueva fuente
tampoco crea una allocation física.

El sistema diferencia ASSIGN_AVAILABLE, ASSIGN_PENDING_COMMITMENT
y REASSIGN. Deben preservarse los controles de cantidad por línea,
producto, punto y OC.

Ver [AC-FIN-001](../requirements/AC-FIN-001-capacidad-compra-anulaciones.md).
