# ADR-022 — Actualizaciones operativas masivas tipadas

**Estado:** ACCEPTED

## Contexto

Medicarte y OLP actualizan grandes conjuntos de autorizaciones en etapas distintas. Cada etapa permite modificar un solo dato y usa la llave de negocio `numero_autorizacion + codigo_medicamento`. Implementar tres pipelines independientes duplicaría validación, staging, idempotencia, auditoría y manejo de archivos.

## Decisión

Implementar un único mecanismo de `bulk updates` parametrizado por un catálogo cerrado de tipos de operación:

| Tipo                           | Actor     | Columna mutable                                                |
| ------------------------------ | --------- | -------------------------------------------------------------- |
| `ASSIGN_DISPENSATION_LOCATION` | MEDICARTE | `lugar_dispensacion`                                           |
| `REPORT_DISPENSATION_DATE`     | OLP       | `fecha_dispensacion`                                           |
| `REPORT_APPLICATION_DATE`      | MEDICARTE | `fecha_aplicacion` (`fecha_aplicacion_medicamento` en archivo) |

Cada tipo define en backend su permiso, precondiciones, esquema exacto, normalización, validación y efectos de dominio. Los tres tipos usan como única llave de negocio la columna `authorization_key` (pareja normalizada `numero_autorizacion + codigo_medicamento`); el archivo contiene exactamente `authorization_key` y la columna mutable externa del tipo. Para `REPORT_APPLICATION_DATE`, `fecha_aplicacion_medicamento` es el nombre contractual externo y se persiste en el campo de negocio existente `authorization_items.fecha_aplicacion DATE`; no es un alias opcional ni un segundo dato. Columnas adicionales, faltantes o duplicadas invalidan la fila o el archivo según el alcance del error. La descarga operativa de OLP solo expone registros con `lugar_dispensacion` asignado; los pendientes de asignación se omiten.

El pipeline reutiliza el patrón existente: archivo máximo de 20 MB, fuente temporal durable en una tabla PostgreSQL separada con `BYTEA`, outbox, BullMQ con solo identificadores, worker, staging por fila, causales estables, idempotencia, auditoría y reporte de resultados.

El worker del contrato 3 reconoce jobs pendientes del contrato 2 únicamente para cerrarlos como `CONTRACT_VERSION_UNSUPPORTED` y eliminar su binario temporal; no intenta procesarlos con el esquema nuevo ni los deja indefinidamente en cola.

## Modelo

Los valores vigentes `lugar_dispensacion`, `fecha_dispensacion` y `fecha_aplicacion` se almacenan en `authorization_items` para lectura y exportación eficientes. Cada escritura incrementa la versión del ítem y crea un registro append-only en `operational_field_changes` con campo, valor anterior, valor nuevo, actor, organización, tipo de operación, lote, fila, idempotency key y fecha.

Las dos fechas son fechas calendario (`DATE`/`YYYY-MM-DD`), no instantes UTC. Los timestamps de carga, cambio y auditoría sí se persisten en UTC. `lugar_dispensacion` es texto libre (solo valor no vacío y normalización de espacios). `fecha_aplicacion` es inmutable una vez `audit_status = APROBADO`.

La duplicación entre valor vigente e historial es deliberada: el ítem sirve consultas actuales y el historial evita sobrescrituras silenciosas. El historial no reemplaza `audit_events`; aporta el detalle de negocio y `audit_events` registra la acción de seguridad/operación.

## Estados derivados

- `application_site_status` no se persiste: se deriva como `PENDIENTE_ASIGNACION` si `lugar_dispensacion` es nulo y `ASIGNADO` si tiene valor.
- `support_status` se elimina: la aplicación no conoce archivos individuales ni determina completitud documental.
- Al persistir por primera vez `fecha_dispensacion`, `operation_status` pasa de `LISTO_PARA_DISPENSAR` a `DISPENSACION_REPORTADA`.
- Una corrección posterior de `fecha_dispensacion` conserva `DISPENSACION_REPORTADA` y crea historial.
- `DISPENSADO` continúa reservado para `audit_status = APROBADO`.
- `fecha_aplicacion` no crea un estado operacional adicional.

## Consistencia y eventos

Cada fila válida se procesa atómicamente: valor vigente, versión, historial, auditoría y, cuando aplique, outbox. Asignar o modificar `lugar_dispensacion` produce respectivamente `DISPENSATION_LOCATION_ASSIGNED` o `DISPENSATION_LOCATION_CHANGED`; el correo a OLP se deduplica por ítem, versión del campo y destinatario.

No se define atomicidad de todo el archivo: las filas válidas pueden actualizarse y las inválidas se reportan individualmente.

## Consecuencias

- Agregar otro tipo exige una decisión explícita de actor, permiso, esquema y efectos; no se aceptan nombres de campo arbitrarios enviados por el cliente.
- Las descargas siguen siendo on-demand y no persistentes; contienen la vista completa permitida al actor, no la plantilla reducida de actualización.
- El backend vuelve a validar permisos y alcance por cada fila, incluso en reintentos.
