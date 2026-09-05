# ADR-027 — Manejo de errores por registro en operaciones masivas (bandeja transversal de novedades)

**Estado:** ACCEPTED
**Fecha:** 2026-09-04
**Reemplaza/complementa:** reglas dispersas de ADR-013, ADR-022 y ADR-024 (ninguna las contradice; este ADR las generaliza y formaliza)

## Contexto

El proceso maneja cargas masivas en varias etapas (autorizaciones, Anexo Tarifario, actualizaciones MEDICARTE/OLP/MTD Compras, soportes, auditoría). Hasta ahora el manejo de errores estaba resuelto de forma correcta pero desigual por módulo: `import_rows`/`validation_errors` para autorizaciones (SPEC-001), `bulk_update_rows` con causales por fila (ADR-022), `tariff_annex_import_rows` (SPEC-014) y una bandeja central `novelties` introducida para el flujo objetivo. Faltaba una regla formal única que obligara a tratar el error a nivel de registro, clasificara la causa y garantizara corrección/recarga/reproceso sin reprocesar archivos completos. Además, la confirmación de importaciones se ejecutaba en una sola transacción de lote: un fallo técnico inesperado revertía registros ya válidos, y el `process_status` no se derivaba de las causales activas.

## Decisión

### 1. Regla global (transversal a toda operación masiva)

> Toda operación masiva se procesa a nivel de registro. Los registros válidos se procesan y conservan su avance. Los registros inválidos quedan en la bandeja de novedades con causa exacta, etapa, lote de origen y demás datos de trazabilidad. El usuario puede visualizar y descargar únicamente los registros rechazados, corregirlos y recargarlos sin reprocesar el archivo completo.

> Cuando la causa de un error pueda resolverse con un cambio interno del sistema (crear el producto en el Anexo Tarifario, corregir parametrización, completar una validación humana), el sistema permite reprocesar el registro sin exigir una nueva carga del archivo original.

### 2. Error de archivo vs. error de registro

- **Error de archivo:** el lote completo se rechaza (`status = FAILED`, `last_error_code` con la causa) y no se procesa ninguna fila. Solo procede cuando el archivo no puede interpretarse con seguridad: formato no soportado, separador incompatible, archivo vacío o corrupto, encabezados requeridos inexistentes, estructura global inválida o archivo que corresponde a otro tipo de carga.
- **Error de registro:** si la estructura del archivo es válida, cada fila se procesa independientemente. Un error en una fila no rechaza ni revierte otras filas (ejemplo de referencia: 8.430 filas → 8.397 procesadas, 33 en novedades, sin reprocesar las 8.397).

### 3. Resultado de toda carga masiva

Todo lote expone como mínimo: archivo (nombre/identificador), `batchId`, fecha/hora, usuario, tipo de carga, total de filas, procesados correctos, rechazados, actualizados/omitidos cuando aplique (p. ej. `UNCHANGED_VALUE`, `EXISTING_ITEM_REVIEW_REQUIRED`) y estado general. Desde el resultado de cada etapa se puede consultar el detalle por fila y descargar únicamente las novedades del lote seleccionado; la bandeja transversal también permite filtrar por lote.

### 4. Bandeja transversal = `novelties` (no se crea un modelo paralelo)

`novelties` + catálogo `novelty_codes` es el único destino de errores de procesamiento de cualquier módulo. Campos del requerimiento y mapeo al modelo vigente:

| Dato requerido                        | Campo en el modelo vigente                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| identificador del error               | `novelties.id`                                                          |
| lote de origen                        | `import_batch_id` / `bulk_update_batch_id` (+`source_row_number`)       |
| llave única del registro / autorización / documento / producto | `authorization_item_id` + `original_row` (evidencia completa de la fila) |
| etapa del proceso / módulo            | `stage` (CSV, AUTORIZACIONES, ANEXO_TARIFARIO, CLASIFICACION, MIPRES, MEDICARTE, MTD_COMPRAS, OLP, AUDITORIA, OPERACION…) |
| código de error                       | `code → novelty_codes.code` (catálogo cerrado y versionable)            |
| categoría del error                   | `novelty_codes.error_type` (nuevo, ver §5)                              |
| descripción legible                   | `description`                                                           |
| campo relacionado / valor recibido    | `field` / `received_value`                                              |
| fecha/hora y usuario                  | `processed_at` / `created_by`                                           |
| referencia al registro original       | `original_row`                                                          |
| intentos / historial                  | `attempt_number` por novedad; cada intento deja su fila de staging y su `audit_events`; no se sobrescriben eventos |

Estados: **no se crea una taxonomía nueva**. El estado funcional `PENDIENTE` corresponde a `active = true`; `RESUELTO`/`CORREGIDO`/`REPROCESADO` corresponden a `active = false` con el evento de auditoría que explica el cierre (`NOVELTY_RESOLVED` con `reason`). `DESCARTADO` queda fuera de alcance hasta que exista una decisión de negocio; no se elimina ninguna novedad.

### 5. Clasificación del tipo de error

`novelty_codes.error_type` es columna de catálogo con tres valores:

- `CORREGIBLE_POR_CARGUE`: el dato externo debe corregirse y recargarse (formato, fecha inválida, identificador incorrecto, valor obligatorio vacío, llave duplicada en archivo, inconsistencia prescripción/clasificación del archivo fuente).
- `REQUIERE_VALIDACION`: exige intervención de un usuario autorizado (bloqueo por avance operacional, rechazo de auditoría, casos en conciliación humana o migra históricos `MIG_001`).
- `REPROCESABLE_INTERNAMENTE`: el dato original sigue siendo válido; cambió una condición interna (producto creado/activado después en el Anexo `ANX_001`/`ANX_002`, parametrización, conflicto de concurrencia `CONC_001`, error técnico `TECH_001`).

El tipo se sirve con cada error y en los XLSX de diagnóstico. Ampliar la clasificación (nuevos códigos o tipos) no rompe compatibilidad: los códigos son estables y `error_type` es una propiedad del catálogo; un código desconocido se trata como `REQUIERE_VALIDACION` (falla cerrado, nunca se reprocesa a ciegas).

### 6. Descarga de rechazados

La descarga de errores (`GET /api/v1/novelties/xlsx?batchId=…`, filtrable adicionalmente por etapa/tipo/estado/autorización/documento) contiene **todas las columnas originales de la fila** (`original_row`) más, al final: `ESTADO_PROCESAMIENTO` (`PENDIENTE`/`RESUELTO`), `ETAPA_ERROR`, `CODIGO_ERROR`, `TIPO_ERROR`, `DESCRIPCION_ERROR`, más `LLAVE`, `ID_NOVEDAD` e `ID_LOTE`. La descarga siempre exige o aplica el lote seleccionado y nunca mezcla novedades de otros lotes. El archivo se genera on-demand en formato XLSX, sin copia persistente, y se audita. El usuario corrige el subconjunto y lo recarga sin subir el archivo completo; las columnas de diagnóstico se ignoran en la recarga según el contrato de cada módulo.

### 7. Recarga parcial

Se identifica cada registro por la llave funcional ya definida —`authorization_key` normalizada de `NUMERO_AUTORIZACION + COD_COMERCIAL` (SPEC-001, ADR-022)—; no se crea llave paralela. Una recarga puede traer solo registros nuevos, solo corregidos o una mezcla. Al recargarse un corregido: se identifica por llave, se revalida según las reglas de la etapa, se procesa desde la etapa correspondiente, la novedad anterior se marca `active = false` con auditoría, se conserva el historial y no se tocan otros registros del lote anterior.

### 8. Reprocesamiento sin nueva carga

- **Automático (evento determinable en la misma transacción):** creación/reactivación del producto en el Anexo Tarifario revalida los ítems `NOT_LISTED` vía outbox → BullMQ `tariff-annex` (ADR-024, ya operativo); resolución de direccionamiento MIPRES revalida por el flujo existente. Solo transiciones hacia adelante seguras; nunca revierte estados avanzados (`DISPENSATION_REPORTED`, `DISPENSED`, auditoría `APPROVED`).
- **Manual (control humano):** `POST /api/v1/authorization-items/:id/reprocess` con `Idempotency-Key`, protegido por el nuevo permiso atómico `authorizations.reprocess` (solo MTD_ADMIN y MTD_OPERATOR, espejo de `imports.confirm`/`mipres.recheck`). Re-ejecuta la función central de dominio contra el estado actual del catálogo y las dimensiones vigentes; si persiste la novedad, la deja activa; si se resuelve, cierra la novedad con auditoría. Para NO PBS con direccionamiento pendiente reencola el job MIPRES (no llama a MIPRES en el request).
- No hay reprocesamiento automático para `REQUIERE_VALIDACION`, para estados avanzados ni ante causas no determinables.

### 9. Transaccionalidad e idempotencia

- **Frontera transaccional por operación masiva:** recepción del archivo, staging y validación por fila (transacción de lote, solo escribe staging — no escribe dominio); **confirmación/persistencia de efectos: una transacción por registro** (claim atómico de la fila, creación/actualización del ítem, evaluaciones, historial, novedades, auditoría del propio registro y outbox si aplica). Un fallo técnico marca solo esa fila como `PROCESSING_ERROR` con novedad `TECH_001` y el lote continúa. Cierre del lote: transacción separada de totales.
- **Comportamiento ante excepción:** el rollback de una fila pierde únicamente el efecto de esa fila; la fila sigue reclamable (`confirmable` no se consume) o queda marcada con causal estable.
- **Idempotencia:** llave lógica de batch (organización+tipo+sha256+versión de contrato), `Idempotency-Key` con registro de respuesta, `authorization_key` única en `authorization_items` (`on conflict do nothing` + revisión humana `EXISTING_ITEM_REVIEW_REQUIRED`), claims condicionales por fila y outbox con clave idempotente. Repetir la misma carga o reintentar un lote no duplica ítems, eventos ni novedades.
- Recuperación: un lote interrumpido en `CONFIRMING` puede reconfirmarse (las filas ya aplicadas no se repiten).

### 10. Permisos y trazabilidad

Toda acción nueva (consultar bandeja, exportar, reprocesar) usa el mecanismo existente: `AuthGuard` + `AccessService.requirePermission` en backend; la visibilidad de botones en la UI no sustituye la validación de backend. `audit_events` sigue siendo inmutable y append-only (ADR-016): cada cierre/apertura de novedad, reprocesamiento y exportación queda auditada con actor, organización, antes/después y `correlation_id`. Los logs técnicos (batchId, rowId, authorization_key, etapa, código, excepción) no se exponen como mensajes de usuario; la causal funcional visible es `code + description`.

### 11. Auditoría humana ≠ error técnico

El rechazo de auditoría (`AUD_001`) mantiene los conceptos `PENDIENTE/APROBADO/RECHAZADO` del flujo de auditoría (SPEC-006): el rechazo crea novedad activa con motivo obligatorio y devuelve el registro a la etapa que dicta su flujo; no se trata como error de procesamiento ni se mezcla con `TECH_001`.

## Consecuencias

- Un registro defectuoso afecta únicamente a ese registro; el lote continúa.
- El reproceso humano mínimo: los errores internos se resuelven desde el sistema sin recargar archivos.
- Una sola bandeja con causa, etapa, lote, tipo y evidencia original para todo el proceso; los modelos de staging por módulo se conservan como referencia y no se duplican en una mesa nueva.
- Costos: una migración aditiva (`error_type` + código `TECH_001`), refactor de `confirm` hacia transacciones por registro, y más casos de prueba (parcialidad, resolución, exportación, permisos).
- No se tocan contratos externos existentes; se agregan filtros y columnas de diagnóstico a las exportaciones y un endpoint de reprocesamiento.
