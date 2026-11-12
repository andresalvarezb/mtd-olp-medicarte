# BR-AUTO-EXP-001 — Gracia y continuidad de atención después del vencimiento

**Estado:** reglas funcionales aprobadas; validación normativa/contractual pendiente
**Fecha:** 2026-11-04
**Alcance:** vigencia, atención, reserva física y vínculo AUTO–OC. No cambia cantidades solicitadas, gestionadas por OLP, despachadas o recibidas.

## Responsabilidades

- **MTD:** conserva y administra la autorización y sus relaciones comerciales mediante las operaciones existentes.
- **MEDICARTE:** registra entrega o aplicación desde el detalle de autorización, usando únicamente el saldo autorizado y físicamente reservado compatible.
- **Worker:** desde el sexto día revisa evidencia confirmada y libera, con auditoría `SYSTEM`, solo las autorizaciones sin atención.
- **OLP:** conserva las cantidades comerciales y despachos registrados; el vencimiento de una AUTO no modifica esos datos.

No se amplían roles ni permisos. Se mantienen las validaciones existentes de habilitación, organización/punto, producto, autorización, inventario, capacidad e identidad.

## Reglas aprobadas

1. La fecha final es inclusiva. En `America/Bogota`, `hoy <= FECHA_FINAL_VIGENCIA` permite atención si pasan las demás validaciones.
2. Los días calendario 1 a 5 posteriores permiten iniciar o continuar atención. Pueden crearse reservas físicas vinculadas a una OC activa solo contra recepción real y bajo las validaciones vigentes.
3. Desde el día 6, sin atención confirmada, se bloquean nuevas atenciones y el worker libera el saldo físico pendiente y todas las fuentes activas AUTO–OC, sin esperar al cierre del mes. Si el producto llega después, la fuente liberada no reconstruye la reserva.
4. Desde el día 6, con alguna atención confirmada, se conserva el saldo no consumido y el vínculo activo AUTO–OC. Una recepción física posterior de esa misma OC puede aumentar la reserva de esa AUTO mientras su fuente AUTO–OC siga activa. La reserva queda limitada por el saldo de su snapshot de compra, la cantidad autorizada pendiente neta de reservas activas y las unidades físicamente recibidas que aún no estén comprometidas. No se crea una relación comercial nueva ni se reactiva una fuente liberada.
5. Una autorización totalmente atendida no acepta más consumo. La evidencia consumida, las recepciones, las fuentes y las allocations no se borran ni se reescriben por vencimiento.
6. La elegibilidad de una **nueva** relación de compra vencida termina al concluir el quinto día de gracia, aunque la autorización siga perteneciendo al mes calendario de vencimiento. Un vínculo ya activo se conserva o libera según las reglas anteriores. Una renovación no restaura automáticamente allocations ni fuentes liberadas.
7. Las fechas retroactivas no alteran la ventana calculada con la fecha actual de Bogotá. La fecha de operación no puede ser futura.

## Evidencia y cantidades

La protección usa el mismo criterio en worker, fulfillment, aplicaciones y consulta:

- `authorization_fulfillments` con cantidad positiva y `confirmed_at`;
- `patient_applications` con estado `CONFIRMED`, responsable/fecha de confirmación y líneas positivas;
- `inventory_authorization_allocations.consumed_quantity > 0`, como evidencia cuantitativa de consumo transaccional.

No cuentan borradores, cancelaciones, intentos fallidos ni filas no confirmadas. Para evitar sumar dos veces la misma atención, el saldo autorizado pendiente se calcula con la mayor cantidad acumulada entre fulfillment moderno, aplicaciones históricas confirmadas y consumo de allocations. El saldo físico se calcula por allocation como `allocated_quantity - consumed_quantity - released_quantity`.

`authorization_dispensations` conserva fecha y datos del reporte, pero no cantidad ni un estado de confirmación y el importador puede actualizar la fecha. No permite determinar saldo parcial; por sí sola no habilita consumo. Se requiere decisión y reconciliación de esos registros antes de tratarlos como atención cuantificada.

## Aceptación observable

| Caso                                              | Resultado                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Día de vencimiento, día 1 y día 5                 | Atención permitida hasta los saldos reservados/autorizados; recepción real puede crear reserva.                      |
| Día 6 sin atención confirmada                     | Primera atención rechazada; reserva pendiente y fuente activa OC liberadas; historial intacto.                       |
| Día 6 o posterior con atención parcial confirmada y nueva recepción de la misma OC activa | Se crea únicamente el top-up permitido por snapshot, saldo autorizado no reservado y cantidad física recibida; el reintento no duplica allocations. |
| Día 6 o posterior con atención parcial, pero sin recepción nueva, saldo autorizado o capacidad comprometida | No se crea reserva adicional ni inventario. |
| Atención histórica confirmada                     | Protege la reserva y se incluye una sola vez en el saldo atendido.                                                   |
| Borrador, cancelación o intento fallido           | No protege la reserva ni habilita continuidad.                                                                       |
| Recepción posterior a liberación                  | No crea allocation para la fuente liberada.                                                                          |
| Repetición del worker                             | No duplica liberación, auditoría ni invalidación.                                                                    |
| Sobreconsumo / autorización completa              | Operación rechazada sin alterar historial.                                                                           |
| Cambio de mes/año y medianoche Bogotá             | El límite se decide por fechas calendario de Bogotá, no por zona del servidor.                                       |

## Decisiones y validaciones pendientes

- Validación normativa y contractual para entregar/aplicar medicamentos durante o después de la vigencia impresa.
- Reconciliación de `authorization_dispensations` históricas que carecen de cantidad y confirmación explícita.
- Regla para crear una relación comercial nueva con una AUTO vencida tras el día 5: sigue bloqueada; la excepción aprobada solo permite completar progresivamente la fuente AUTO–OC ya activa contra una recepción física de esa misma OC.
- La asignación automática de stock físico libre a AUTOs vigentes se define en [BR-AUTO-DISP-001](BR-AUTO-DISP-001-asignacion-automatica-disponibilidad.md). Este documento no define devolución financiera, liberación por inasistencia ni restauración de información previamente liberada.

## Evidencia técnica

- Dominio: `packages/domain/src/authorization-fulfillment-window.ts`.
- Atención y reservas: `apps/api/src/fulfillments/authorization-fulfillment.repository.ts`, `apps/api/src/applications/patient-application.repository.ts` y `apps/api/src/receipts/receipt.repository.ts`.
- Liberación: `apps/worker/src/inventory-expiration-release.ts`.
- Consulta MEDICARTE: `apps/api/src/clinical/authorization-query.repository.ts` y `apps/web/features/authorizations/consulta-autorizaciones-view.tsx`.
- Elegibilidad de nueva relación OC: `packages/domain/src/authorization-assignment-validity.ts`.

Ver también [BR-AUTO-OC-001](BR-AUTO-OC-001-vigencia-para-asignacion.md), [BR-AUTO-REN-001](BR-AUTO-REN-001-estado-16-vigencia.md), [CE-08 a CE-13](../casos-especiales/liberaciones-reservas.md) y [ADR-043](../adr/043-authorization-order-receipt-fulfillment-reassignment.md).
