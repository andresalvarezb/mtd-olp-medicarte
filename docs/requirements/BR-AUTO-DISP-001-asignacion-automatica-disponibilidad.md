# BR-AUTO-DISP-001 — Asignación automática de producto disponible a AUTOs

**Estado:** asignador base integrado en PR #154; complemento de reconciliación sujeto a revisión, pruebas y activación controlada.
**Fecha:** 2026-11-12.

## Objetivo

Asignar automáticamente producto físicamente disponible a AUTOs habilitadas y vigentes, priorizando la que vence primero, respetando el punto del paciente y evitando asignaciones parciales intencionales.

## Alcance

- El sistema asigna stock recibido y libre a una AUTO elegible.
- El stock puede provenir de una o varias OCs. Cada OC fuente debe contener el mismo producto y contar con cantidad física recibida, disponible y compatible con el punto.
- La asignación crea una reserva física para la AUTO y conserva la trazabilidad de cada OC fuente.
- La reserva física no modifica la cantidad solicitada de la OC ni reescribe el snapshot comercial de `purchase_order_authorization_sources`.
- Esta regla no transfiere una reserva activa de una AUTO a otra ni permite reutilizar unidades consumidas.

## Disparadores

1. Evaluar cuando aumenta el saldo físico disponible por una recepción confirmada o por la liberación de una reserva.
2. Si el producto queda esperando por falta de una AUTO compatible, reevaluarlo cuando una AUTO del mismo producto y punto pase a estar habilitada y vigente.
3. La repetición de un evento o reintento no debe crear reservas duplicadas.

## Elegibilidad de la AUTO

La AUTO participa cuando:

- Corresponde al mismo código comercial del producto disponible.
- Está habilitada según las validaciones operativas vigentes (estado fuente `5` y estado de habilitación `ENABLED`), no está anulada y tiene saldo autorizado pendiente de atención.
- Su fecha final de vigencia es hoy o posterior, usando el calendario `America/Bogota`. La fecha final es inclusiva.
- No se encuentra en los días de gracia posteriores al vencimiento. La gracia de atención y continuidad de reservas existentes sigue definida por [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md); no habilita una asignación nueva bajo esta regla.
- Pasa las validaciones vigentes de cobertura (incluido MIPRES cuando corresponda), producto, organización y alcance operativo.

El saldo pendiente se calcula con la regla canónica de atención y reservas, sin sumar dos veces entregas, aplicaciones, consumos o allocations. Una AUTO sin saldo pendiente no participa.

## Coincidencia del punto

El punto de la AUTO se resuelve con esta precedencia:

1. Programación activa del paciente.
2. Punto predefinido o habitual activo del paciente, si no hay programación activa.
3. Mapeo activo del producto, si no hay punto del paciente.

El punto resuelto debe coincidir exactamente con el punto donde está disponible el stock. No se traslada producto entre puntos como parte de esta regla. Si el punto falta o es ambiguo, la AUTO se excluye y el stock permanece disponible en su punto de origen. El sistema registra el motivo y vuelve a evaluar cuando cambie la disponibilidad o exista una AUTO compatible.

## Prioridad y distribución

- Ordenar las AUTOs elegibles por fecha final de vigencia ascendente, de la que vence antes a la que vence después.
- Si dos AUTOs tienen la misma fecha final, ordenarlas por `authorization_key` ascendente para obtener un resultado estable.
- Para cada AUTO, calcular la cantidad pendiente que falta por reservar después de descontar cantidades ya consumidas y reservas físicas activas.
- No crear una reserva parcial para una AUTO. Si el saldo completo pendiente se puede cubrir con stock libre de una o varias OCs del mismo producto y punto, crear todas las partes dentro de una misma operación atómica.
- Si la AUTO prioritaria no puede completarse, probar la siguiente AUTO elegible que sí pueda completarse con el saldo restante. Si ninguna puede completarse, dejar el producto sin asignar en su punto.
- No contar cantidades solicitadas o pendientes de recepción como stock disponible. Cada parte de la reserva debe quedar limitada al saldo físico libre de su OC fuente.
- Cuando el stock tenga vencimiento de lote, seleccionar primero el lote que vence antes (FEFO). Si la fuente no tiene vencimiento de lote, usar la fecha de recepción más antigua y luego el código de OC en orden ascendente.

## Integridad, acceso y auditoría

- Revalidar dentro de la transacción la vigencia de la AUTO, el saldo autorizado pendiente, el saldo físico por OC/producto/punto y la autorización de organización y punto.
- Serializar asignaciones concurrentes para que dos eventos no reserven las mismas unidades.
- Registrar la AUTO destino, producto, punto, cantidad, OCs fuente, evento disparador, fecha y actor del proceso.
- Mantener intactos los registros de recepción, consumo, cantidades solicitadas y snapshots comerciales de OC.
- Una vez creada la reserva, su continuidad o liberación se rige por [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md).

## Criterios de aceptación

1. Una recepción o liberación que aumenta el stock libre dispara la evaluación de AUTOs compatibles.
2. Una AUTO con estado fuente `5`, estado de habilitación `ENABLED`, vigente, no anulada, con saldo pendiente y producto coincidente puede ser candidata; una AUTO dentro del período de gracia no puede recibir una asignación nueva.
3. Una AUTO con programación activa se evalúa en ese punto; en su ausencia se usa el punto habitual activo y luego el mapeo del producto. El stock solo se asigna si ambos puntos coinciden.
4. Las AUTOs se procesan por vencimiento ascendente y, para fechas iguales, por `authorization_key` ascendente.
5. Si una AUTO necesita 6 unidades y existen 2 unidades libres en una OC y 4 en otra, ambas fuentes pueden completarla con una reserva total de 6.
6. Si una AUTO necesita 6 y solo hay 5, no se le reserva una parte. El sistema prueba la siguiente candidata que pueda completarse; si ninguna puede, el stock queda libre.
7. El sistema puede asignar producto de cualquier OC fuente compatible, pero nunca más que su cantidad física recibida y libre para ese producto y punto.
8. Si no hay una AUTO compatible, el stock permanece disponible en el mismo punto. Cuando una AUTO compatible quede habilitada y vigente, el stock pendiente vuelve a evaluarse.
9. Reprocesar el mismo evento o ejecutar eventos concurrentes no duplica reservas ni supera stock recibido o saldo autorizado.
10. La asignación registra el detalle de cada OC fuente y no cambia la cantidad comercial de la OC ni su snapshot AUTO–OC.
11. Las reservas ya existentes y las cantidades consumidas no se transfieren bajo esta regla.

## Fuera de alcance

- Transferir una reserva activa desde una AUTO origen a otra AUTO destino.
- Crear stock a partir de cantidades solicitadas o pendientes de recepción.
- Mover producto entre puntos.
- Cambiar cantidades comerciales de OCs o restaurar fuentes liberadas.

## Evidencia técnica y trazabilidad

La asignación manual vigente se encuentra en `apps/api/src/inventory/inventory-availability.repository.ts`, en `assignBatch()` y `resolveAssignment()`. La implementación de esta regla agrega selección automática por prioridad de vencimiento y composición de una reserva completa desde una o varias OCs; su evidencia de pruebas y revisión se mantiene en el PR.

Ver [BR-AUTO-OC-001](BR-AUTO-OC-001-vigencia-para-asignacion.md), [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md) y [ADR-043](../adr/043-authorization-order-receipt-fulfillment-reassignment.md).

## Complemento: disponibilidad preexistente y reevaluación periódica

La ausencia de un evento nuevo no debe dejar indefinidamente sin evaluar stock recibido
antes del despliegue. Se agrega una conciliación explícita y periódica que reutiliza el
asignador y sus reglas originales. No altera reservas existentes ni cantidades consumidas.

Criterios adicionales de aceptación:

12. El stock preexistente puede asignarse sin fabricar una recepción o editar una AUTO.
13. La simulación se ejecuta en una transacción READ ONLY y muestra el plan sin persistirlo.
14. El barrido pagina productos completos, sin dividir artificialmente sus OCs fuente.
15. La repetición y concurrencia de barridos no duplican reservas; fallos y productos
    ocupados se reportan y se reevaluan, no se presentan como éxito.
16. El actor del scheduler se configura explícitamente y conserva permisos reales;
    no se crean administradores ni se elevan alcances para ejecutar la conciliación.
17. El scheduler se entrega desactivado. Su activación de escritura requiere validación
    de la simulación y aprobación operativa; el merge no constituye esa aprobación.

Diseño, variables, pruebas y operación:
[Reconciliación de disponibilidad](../operations/auto-availability-reconciliation.md).
