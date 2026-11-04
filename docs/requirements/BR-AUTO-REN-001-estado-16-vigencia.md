# BR-AUTO-REN-001 — Transición efectiva 16 → 5 al renovar vigencia

## Alcance

La autorización importada inicialmente en estado fuente 16 puede actualizar su estado **efectivo** a 5 cuando un usuario autorizado modifica FECHA_FINAL_VIGENCIA (edición manual) o se carga nueva fecha en una recarga XLSX. Esta transición solamente resuelve el bloqueo por estado fuente: **no implica autorización operativamente habilitada**.

## Precondiciones de la conversión

- Registro existente, con estado efectivo actual 16.
- Fecha anterior y nueva válidas (YYYY-MM-DD o YYYYMMDD).
- Nueva fecha estrictamente posterior a la anterior y >= fecha calendario de hoy en America/Bogota.
- Se realiza bajo el control transaccional y autorización de la ruta respectiva.
- No se aplica a otro estado distinto de 16.

## Efectos de PROMOTED

- source_data.ESTADO_AUTORIZACION=5, source_status_normalized=5 y enablement_status=ENABLED en una transacción.
- Evidencia de estado inicial 16 y fechas anterior/nueva conservada en __authorizationRenewal16To5 y evento de auditoría.
- El resto de los estados, cobertura, AT, cantidades, MIPRES, OC, inventario y fulfillment **no se habilitan ni modifican por excepción**; se evalúan por las reglas existentes.

## Uso de reservas y compra pendiente después del vencimiento (ampliación 2026-11-03)

La fecha final es inclusiva y una autorización vencida puede recibir atención
durante los días calendario 1 a 5 posteriores. Desde el día 6, la continuidad
depende de evidencia de atención confirmada y del saldo autorizado y físico
disponible, conforme a
[BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md).

Sin atención confirmada, el worker libera desde el día 6 el saldo no consumido
y las fuentes activas de OC, sin esperar al cierre del mes. Con atención
confirmada, conserva el saldo reservado y el vínculo activo. Una recepción
posterior de esa misma OC activa puede completar progresivamente la reserva
según los límites de [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md).
Una renovación posterior no restaura
automáticamente reservas o fuentes liberadas ni recupera capacidad comprometida
a otra AUTO.

La elegibilidad para nuevas relaciones de OC vencidas también termina al quinto
día de gracia. Una relación manual posterior tras renovación solo procede bajo
las validaciones de compra existentes; no restaura la fila ni la allocation
liberada y no crea inventario ni allocation hasta que exista una recepción real.

Las filas fuente liberadas se conservan con su `id` y evidencia originales.
Una nueva fuente activa para la misma pareja línea–AUTO tiene otro `id`; la
selección siempre es manual. Ver también [AC-FIN-001 — capacidad pendiente de
OC después de una liberación](AC-FIN-001-capacidad-compra-anulaciones.md).

## Recargas posteriores

Cuando la AUTO ya tiene un evento de renovación, el estado efectivo 5 se mantiene si una recarga vuelve a declarar 16 con fecha igual o posterior a la registrada; no se puede regresar silenciosamente a una fecha anterior (causal técnica AUTHORIZATION_RENEWAL_STALE_RELOAD; la fila falla sin mutar). Otros estados fuente distintos de 16 siguen su semántica habitual.

## Cobertura de pruebas

Pruebas unitarias: ampliación válida, fecha límite hoy, no cambio, fecha antigua o inválida, otros estados, preservación e idempotencia. Pruebas de integración: edición manual, recarga parcial XLSX, replay de fecha; comprobar que las dimensiones adicionales mantengan sus propios bloqueos.

## Límite conocido no modificado

La proyección SQL de algunas vistas y la elegibilidad general de compra todavía
tienen diferencias de clasificación temporal. Esta regla no las resuelve de
forma global: las validaciones específicas de entrega, aplicación y selección
manual de destino deben aplicar las restricciones anteriores.
