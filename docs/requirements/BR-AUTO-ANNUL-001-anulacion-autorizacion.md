# BR-AUTO-ANNUL-001 — Anulación de autorización

## Regla aprobada

Una autorización puede anularse cuando **no existe ninguna entrega o aplicación confirmada**, aunque tenga una o varias OC, esté asignada o parcialmente asignada. Una sola unidad atendida bloquea definitivamente la anulación.

## Ejecución

- Solo MTD con permiso `authorizations.manual_edit`.
- Endpoint: `POST /api/v1/authorizations/:id/annul`, motivo obligatorio de 5 a 1000 caracteres y versión esperada.
- Backend transaccional; bloquea la autorización antes de comprobar consumo.
- Guardas: `authorization_fulfillments`, `patient_applications` confirmadas y `inventory_authorization_allocations.consumed_quantity > 0`.
- Libera `allocated_quantity - consumed_quantity - released_quantity` en todas las reservas activas, poniendo `RELEASED` y registrando auditoría.
- Marca inmutable en `source_data.__mtdAnnulment`, `source_status_normalized=ANULADA`, `enablement_status=BLOCKED_SOURCE_STATUS`.
- Nuevas recargas XLSX y edición manual de esa AUTO se rechazan, sin reactivación implícita.
- Mantiene `purchase_order_authorization_sources`, las OC y las evidencias históricas, sin cancelar la OC.
- La disponibilidad física aumenta solo por reservas liberadas sobre stock recibido: **nunca crea existencias por OC sin recepción**.
- Conserva la trazabilidad de las OC y snapshots; si es necesario redistribuir compromisos de compra no recibidos a una nueva AUTO debe usarse el flujo explícito de reasignación, no la anulación como inventario virtual.

## Pruebas de aceptación

1. AUTO 10 / OC 10 / reserva 6 / consumo 0 → anulada, 6 liberadas, OC vigente.
2. AUTO 10 / consumo 1 → 409, sin modificación.
3. AUTO sin OC → anulada, 0 liberadas.
4. MEDICARTE → 403.
5. Segunda anulación y edición posterior → 409.
6. Recarga XLSX posterior → fila rechazada, AUTO sigue anulada.
7. Concurrencia de asignación/consumo y anulación → una transacción debe esperar; nunca liberar unidades consumidas.

## Fuera de alcance

- Revertir entregas o aplicaciones.
- Cancelar o modificar OC, recepciones o inventario físico.
- Hacer merge o desplegar sin pruebas de integración.

## Complemento AC-FIN-001 — Capacidad de compra

La anulación conserva las fuentes históricas marcadas como liberadas,
sin cancelar la OC ni alterar sus cantidades.

Cuando existe saldo de compra pendiente sin comprometer, otra AUTO
elegible puede vincularlo mediante importación de OC existente con
AUTO_ORIGEN vacía.

Esta vinculación no es stock físico ni reasignación histórica 1:1.

Ver [AC-FIN-001 — capacidad de compra](AC-FIN-001-capacidad-compra-anulaciones.md).
