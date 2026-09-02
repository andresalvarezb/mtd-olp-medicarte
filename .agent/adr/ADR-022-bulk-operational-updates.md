# ADR-022 — Actualizaciones operativas masivas tipadas

**Estado:** ACCEPTED

## Contexto

Medicarte y OLP actualizan grandes conjuntos de autorizaciones en etapas distintas. Cada etapa permite modificar un solo dato y usa la llave de negocio `numero_autorizacion + codigo_medicamento`. Implementar tres pipelines independientes duplicaría validación, staging, idempotencia, auditoría y manejo de archivos.

## Decisión

Implementar un único mecanismo de `bulk updates` parametrizado por un catálogo cerrado de tipos de operación:

| Tipo                           | Actor     | Datos actualizados                       |
| ------------------------------ | --------- | ---------------------------------------- |
| `ASSIGN_DISPENSATION_LOCATION` | MEDICARTE | `lugar_dispensacion`, `fecha_programada` |
| `REPORT_DISPENSATION_DATE`     | OLP       | `fecha_dispensacion`                     |
| `REPORT_APPLICATION_DATE`      | MEDICARTE | `fecha_aplicacion`                       |

Cada tipo define en backend su permiso, precondiciones, esquema exacto, normalización, validación y efectos de dominio. Los tipos `ASSIGN_DISPENSATION_LOCATION` y `REPORT_DISPENSATION_DATE` usan como única llave de negocio la columna `authorization_key` (pareja normalizada `numero_autorizacion + codigo_medicamento`); el archivo contiene exactamente `authorization_key` y la columna mutable del tipo. `REPORT_APPLICATION_DATE` conserva la pareja `numero_autorizacion` + `codigo_medicamento` y la columna mutable. Columnas adicionales, faltantes o duplicadas invalidan la fila o el archivo según el alcance del error. La descarga operativa de OLP solo expone registros con `lugar_dispensacion` asignado; los pendientes de asignación se omiten.

El pipeline reutiliza el patrón existente: archivo máximo de 20 MB, fuente temporal durable en una tabla PostgreSQL separada con `BYTEA`, outbox, BullMQ con solo identificadores, worker, staging por fila, causales estables, idempotencia, auditoría y reporte de resultados.

## Modelo

Los valores vigentes `lugar_dispensacion`, `fecha_dispensacion` y `fecha_aplicacion` se almacenan en `authorization_items` para lectura y exportación eficientes. Cada escritura incrementa la versión del ítem y crea un registro append-only en `operational_field_changes` con campo, valor anterior, valor nuevo, actor, organización, tipo de operación, lote, fila, idempotency key y fecha.

Las dos fechas son fechas calendario (`DATE`/`YYYY-MM-DD`), no instantes UTC. Los timestamps de carga, cambio y auditoría sí se persisten en UTC. `lugar_dispensacion` es texto libre (solo valor no vacío y normalización de espacios). `fecha_aplicacion` es inmutable una vez `audit_status = APPROVED`.

La duplicación entre valor vigente e historial es deliberada: el ítem sirve consultas actuales y el historial evita sobrescrituras silenciosas. El historial no reemplaza `audit_events`; aporta el detalle de negocio y `audit_events` registra la acción de seguridad/operación.

## Estados derivados

- `application_site_status` no se persiste: se deriva como `PENDING_ASSIGNMENT` si `lugar_dispensacion` es nulo y `ASSIGNED` si tiene valor.
- `support_status` se elimina: la aplicación no conoce archivos individuales ni determina completitud documental.
- Al persistir por primera vez `fecha_dispensacion`, `operation_status` pasa de `READY_TO_DISPENSE` a `DISPENSATION_REPORTED`.
- Una corrección posterior de `fecha_dispensacion` conserva `DISPENSATION_REPORTED` y crea historial.
- `DISPENSED` continúa reservado para `audit_status = APPROVED`.
- `fecha_aplicacion` no crea un estado operacional adicional.

## Consistencia y eventos

Cada fila válida se procesa atómicamente: valor vigente, versión, historial, auditoría y, cuando aplique, outbox. Asignar o modificar `lugar_dispensacion` produce respectivamente `DISPENSATION_LOCATION_ASSIGNED` o `DISPENSATION_LOCATION_CHANGED`; el correo a OLP se deduplica por ítem, versión del campo y destinatario.

No se define atomicidad de todo el archivo: las filas válidas pueden actualizarse y las inválidas se reportan individualmente.

## Consecuencias

- Agregar otro tipo exige una decisión explícita de actor, permiso, esquema y efectos; no se aceptan nombres de campo arbitrarios enviados por el cliente.
- Las descargas siguen siendo on-demand y no persistentes; contienen la vista completa permitida al actor, no la plantilla reducida de actualización.
- El backend vuelve a validar permisos y alcance por cada fila, incluso en reintentos.
