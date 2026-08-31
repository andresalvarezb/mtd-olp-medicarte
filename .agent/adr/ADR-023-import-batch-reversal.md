# ADR-023 — Reversión segura y auditable de cargues de autorizaciones

**Estado:** ACEPTADO (aprobado por el responsable en sesión de diseño del 2026-08-31; ver DEC-017)

## Contexto

Un cargue puede subirse por error. Hoy la plataforma no ofrece forma controlada de eliminar las autorizaciones generadas por un `import_batch` específico. Un `DELETE FROM authorization_items WHERE created_from_batch_id = ...` sin controles destruiría evidencia, actividad operativa posterior y referencias de otros cargues.

El modelo ya dispone de la relación explícita necesaria: `authorization_items.created_from_batch_id` (NOT NULL, `ON DELETE RESTRICT`) demuestra de forma inequívoca qué cargue creó cada autorización. `import_rows` conserva la evidencia original por fila y la detección de llaves preexistentes (`EXISTING_ITEM_REVIEW_REQUIRED`) con puntero al ítem detectado.

Todas las entidades hijas de `authorization_items` usan `ON DELETE RESTRICT`: `coverage_evaluations`, `authorization_item_organizations`, `import_rows`, `mipres_checks`/`mipres_directions`, `operational_field_changes`, `bulk_update_rows`, `notifications` (`item_id`) y `audit_reviews`/`audit_findings`. Nada puede borrarse en cascada silenciosa; cualquier hijo vivo aborta un borrado físico.

## Decisión

### Modelo de reversión: hard delete controlado

Se descarta el soft delete/invalidación por tres razones argumentadas y aprobadas:

1. Todos los FK hijos son RESTRICT: el hard delete no puede arrastrar evidencia silenciosamente; los hijos vivos bloquean o se gestionan explícitamente.
2. La evidencia original sobrevive en `import_rows` (resultado, mensaje, llave, datos crudos), `import_source_files` (archivo completo) y `audit_events` (inmutable); el ítem es una proyección derivada de esa evidencia.
3. Con soft delete, el índice único `numero_autorizacion + codigo_medicamento` impediría reimportar la misma llave corregida tras la reversión, obligando a un índice único parcial y a filtrar el flag en bandeja, exportes, indicadores y consolidado, con alto riesgo de regresión transversal.

La selección de ítems es exclusivamente por `created_from_batch_id`; nunca por fecha, usuario, número de autorización u otros criterios indirectos. Los ítems preexistentes (solo detectados o actualizados explícitamente por el cargue) nunca se eliminan.

### Estados del lote

`COMPLETADO → REVIRTIENDO → REVERTIDO`. El lote nunca se elimina: queda como evidencia histórica consultable con `reverted_at`, `reverted_by`, `reverted_removed_items` y `reverted_blocked_items`. `REVIRTIENDO` existe solo dentro de la transacción de reversión: un fallo técnico produce rollback completo y el lote permanece `COMPLETADO`, reintento seguro.

### Regla de bloqueo por actividad posterior (aprobada)

Un ítem creado por el cargue solo puede eliminarse si no tiene actividad posterior. Los hechos que bloquean, con causal estable:

| Causal estable                     | Hecho verificado                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ITEM_HAS_AUDIT_ACTIVITY`          | `audit_status <> 'NO_INICIADO'` o filas en `audit_reviews`.                                                                                                   |
| `ITEM_HAS_MIPRES_ACTIVITY`         | Filas en `mipres_checks` (implica `mipres_directions`).                                                                                                       |
| `ITEM_HAS_OPERATIONAL_UPDATES`     | Filas en `operational_field_changes` o `bulk_update_rows`, `operational_version > 0` o `lugar_dispensacion`/`fecha_dispensacion`/`fecha_aplicacion` no nulos. |
| `ITEM_HAS_NOTIFICATIONS`           | Notificaciones que referencian el ítem **distintas** de los anuncios de creación `AUTHORIZATION_READY_TO_DISPENSE` y `EPS_DIRECTION_PENDING`.                 |
| `ITEM_HAS_UPDATED_SOURCE_EVIDENCE` | `coverage_evaluations` con `evaluation_version > 1` (actualización explícita F2).                                                                             |
| `ITEM_REFERENCED_BY_LATER_IMPORT`  | Filas de `import_rows` de **otros** cargues que referencian el ítem (detección posterior o actualización explícita).                                          |

### Decisión sobre notificaciones de creación (aprobada)

`AUTHORIZATION_READY_TO_DISPENSE` y `EPS_DIRECTION_PENDING` se generan en la misma transacción de confirmación del cargue y no bloquean la eliminación: son efecto de la propia creación, forman parte de la unidad revertida y sus filas se eliminan junto con el ítem. Los correos ya enviados no pueden retractarse; ese riesgo queda documentado y aceptado. Cualquier otra notificación (lugar asignado/cambiado, reporte con referencia al ítem) bloquea con `ITEM_HAS_NOTIFICATIONS`.

`ITEM_NOT_CREATED_BY_BATCH` es un invariante estructural del pipeline (la selección proviene de `created_from_batch_id`), no una causal de ejecución. `BATCH_ALREADY_REVERTED` se refleja como resultado estable (`alreadyReverted: true`), no como error.

### Operación

- `GET /api/v1/imports/:id/reversal-preview`: impacto antes de ejecutar (identificación del lote, filas, creadas, rechazadas, eliminables, bloqueadas con causal y detalle acotado).
- `POST /api/v1/imports/:id/revert`: ejecución con `Idempotency-Key`, permiso `imports.revert` (solo MTD_ADMIN), alcance por organización del lote, revalidado en backend.
- Una única transacción serializada con `pg_advisory_xact_lock` por lote y `for update` del lote: plan, eliminaciones, estado del lote, auditoría e idempotencia commit o rollback juntos. Los bloqueos por reglas de negocio son resultado de negocio (el lote queda `REVERTIDO` con contadores); los errores técnicos revierten todo.
- Segunda ejecución: con la misma clave devuelve la respuesta persistida; con clave nueva devuelve resultado estable `alreadyReverted: true` sin nuevos efectos ni auditorías duplicadas.

### Escrituras derivadas de la reversión (explícitas, no cascadas)

Para cada ítem eliminado: se liberan los eventos de outbox aún `PENDIENTE` del propio cargue (nunca produjeron efectos externos), se libera el puntero `import_rows.authorization_item_id` de las filas del propio lote (la evidencia de fila se conserva), se eliminan las notificaciones de creación exentas, `coverage_evaluations` (solo versión 1 de creación; versiones posteriores bloquean) y `authorization_item_organizations`.

### Auditoría

Append-only, sobrevive al borrado del negocio:

- `IMPORT_BATCH_REVERTED` sobre `import_batch/:id` con evaluados, eliminados, bloqueados, causales, detalle e `correlationId`.
- `AUTHORIZATION_ITEM_REMOVED_BY_IMPORT_ROLLBACK` por ítem eliminado, con `batchId` y llave de negocio.

## Consecuencias

- Revertir un cargue con correcciones pendientes permite reimportar la misma llave corregida de inmediato.
- Los ítems con avance operativo real (auditoría, MIPRES, logística, notificaciones operativas, actualización explícita, referencia de otros cargues) nunca se eliminan; el preview muestra el impacto exacto antes de confirmar.
- La UI expone la acción solo para portadores de `imports.revert`, con confirmación informada por el preview (nunca un «¿Está seguro?» genérico). El alcance de la acción es la sesión vigente: solo se pueden revertir lotes visibles en la bandeja de la sesión actual; no existe reversión de sesiones anteriores (confirmado por el responsable).
- Los correos ya enviados por las notificaciones de creación no se retractan ni se intenta anularlos; la reversión solo afecta los registros de la aplicación (confirmado por el responsable).
- Eventos de outbox `DESPACHADO`/`PROCESADO`/`FALLIDO` del ítem se conservan; un evento en vuelo extremadamente raro puede quedar `FALLIDO` visible en la bandeja de fallos sin corromper datos.
- La reversión es por lote completo; no existe reversión parcial por fila (queda fuera de alcance hasta nueva decisión).
