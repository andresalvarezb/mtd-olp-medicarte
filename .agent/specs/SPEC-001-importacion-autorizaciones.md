# SPEC-001 — Importación de autorizaciones

**Fase:** 2

## Objetivo

Cargar CSV/XLSX de forma idempotente, conservar evidencia por fila y confirmar ítems válidos.

## Entrada mínima conocida

- `NUMERO_AUTORIZACION`
- `COD_COMERCIAL`
- `ESTADO_AUTORIZACION`
- `No.PRESCRIPCION` (valor opcional; vacío clasifica `PBS`)

## Diccionario F2 recibido

El archivo de autorizaciones contiene 26 columnas según el diccionario (versión 2, DEC-016). Las cuatro columnas marcadas como de negocio tienen validación explícita en Fase 2. Las demás se conservan en la evidencia de la fila y del ítem como valores escalares del archivo; no se les asignan obligatoriedad ni reglas semánticas adicionales hasta que exista una decisión documentada.

El contrato normativo de tipo, obligatoriedad, normalización, validaciones, llave y causales está en `../contracts/AUTHORIZATION_IMPORT_DATA_DICTIONARY.md`. Esta sección es su resumen funcional y no debe evolucionar de forma independiente.

| Columna                  | F2        | Tratamiento                                                                                                                                                               |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEPS`                 | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `NUMERO_AUTORIZACION`    | Negocio   | Obligatoria; se recorta, convierte a mayúsculas y colapsa espacios para la llave.                                                                                         |
| `TIP_DOCUMENTO`          | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `IDENTIFICACION_PACIENTE` | Evidencia | El alias de entrada `NUM_DOCUMENTO` se normaliza a este nombre y no se conserva como columna paralela.                                                                  |
| `NOMBRE_PACIENTE`        | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `NUMERO_TELEFONO`        | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `COD_CUPS_PRINCIPAL`     | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `CUPS_PRINCIPAL`         | Evidencia | Desde DEC-016 se conserva sin validación semántica; ya no clasifica cobertura.                                                                                            |
| `COD_COMERCIAL`          | Negocio   | Obligatoria; se recorta, convierte a mayúsculas y colapsa espacios para la llave y `codigo_medicamento`.                                                                  |
| `CUMS`                   | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `NIT_PRESTADOR`          | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `NOMBRE_PRESTADOR`       | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `COD_CUPS_AUTORIZADO`    | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `CUPS_AUTORIZADO`        | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `CANTIDAD`               | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `DOSIS`                  | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `FECHA_ASIGNACION`       | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `FECHA_FINAL_VIGENCIA`   | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `ESTADO_AUTORIZACION`    | Negocio   | Obligatoria; el valor normalizado `5` habilita y cualquier otro valor bloquea por estado de origen.                                                                       |
| `No.PRESCRIPCION`        | Negocio   | Encabezado obligatorio; vacío debe coincidir con producto `PBS` del Anexo; no vacío debe ser numérico de 20 dígitos y coincidir con producto `NO PBS`; deriva `no_prescripcion` sin los últimos 3 dígitos. |
| `OBS_AUTORIZACION`       | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `MEDICO_REMITENTE`       | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `CMNT`                   | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `_Id`                    | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `FPRO`                   | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |
| `VALOR CUOTA MODERADORA` | Evidencia | Se conserva sin validación semántica adicional.                                                                                                                           |

La lista del archivo contiene 26 columnas con el diccionario versión 2; encabezados desconocidos, si aparecen, también se conservan como evidencia sin convertirlos en reglas de negocio.

## Catálogo estable de resultados por fila

| Código                          | Uso                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ROW_VALID`                     | Fila validada y elegible para confirmación de un ítem nuevo.                                           |
| `MISSING_REQUIRED_FIELD`        | Falta un encabezado obligatorio o un valor obligatorio; el valor de `No.PRESCRIPCION` puede ser vacío. |
| `INVALID_FIELD_FORMAT`          | El archivo o valor no cumple el formato técnico definido para F2.                                      |
| `DUPLICATE_IN_FILE`             | La llave aparece más de una vez dentro del mismo archivo.                                              |
| `EXISTING_ITEM_REVIEW_REQUIRED` | La llave ya existe y requiere verificación humana; no se actualiza automáticamente.                    |
| `EXPLICIT_UPDATE_NOT_ALLOWED`   | Una actualización explícita fue intentada fuera de `READY_TO_DISPENSE`.                                |
| `ITEM_CREATED`                  | La fila válida creó un ítem durante la confirmación.                                                   |
| `ITEM_UPDATED`                  | Una actualización explícita autorizada terminó correctamente.                                          |
| `PRODUCT_NOT_IN_TARIFF_ANNEX`   | Código no incluido en el Anexo Tarifario activo; conserva evidencia y no es confirmable.                |
| `PROCESSING_ERROR`              | Error técnico estable de procesamiento, sin exponer la excepción interna.                              |

## Reglas

- `authorization_key = normalizar(NUMERO_AUTORIZACION) + normalizar(COD_COMERCIAL)`.
- `COD_COMERCIAL` alimenta `codigo_medicamento`.
- Un duplicado dentro del archivo no crea dos ítems.
- Si la llave ya existe, la fila se reporta para verificación humana y no se actualiza automáticamente.
- Debe existir una acción explícita de actualización.
- Solo se habilita si `operation_status = READY_TO_DISPENSE`.
- La actualización reemplaza la evidencia y reevalúa las cuatro columnas de negocio (`NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`) de la fila aprobada. `NUMERO_AUTORIZACION + COD_COMERCIAL` debe coincidir con la llave existente y sus componentes de identidad no cambian.
- Después de clasificar la fila nueva, `operation_status` conserva `READY_TO_DISPENSE` solo si la combinación habilitación/cobertura/direccionamiento sigue siendo elegible; en cualquier otra combinación se persiste `BLOCKED`.
- En Fase 2, `NO_PBS + ENABLED + PENDING` queda `BLOCKED` y no invoca MIPRES.
- Se bloquea para `DISPENSATION_REPORTED`, `DISPENSED` y estados posteriores.
- La auditoría de la actualización registra antes/después de `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION` y `No.PRESCRIPCION` normalizados, referencias y hashes de la evidencia anterior/nueva, y el registro idempotente asociado; no duplica la evidencia cruda con datos sensibles en auditoría ni en la respuesta idempotente persistida.
- Los mensajes de excepción técnicos no son causales de negocio.

## Flujo

`UPLOADED -> VALIDATING -> READY_TO_CONFIRM -> CONFIRMING -> COMPLETED`.
Excepciones: `FAILED`, `CANCELLED`.

## Persistencia

`import_batches` (incluye `tariff_rejected_rows`), `import_rows`, `validation_errors`, `authorization_items`, `audit_events`, `novelties` (proyección transversal de la fila rechazada, ADR-027).

## Errores por registro (ADR-027)

- Un error de una fila no rechaza el archivo: las filas válidas continúan y se confirman; cada fila rechazada se proyecta en `novelties` con `code`, `stage`, `field`, `received_value`, `original_row`, lote y fila de origen. El rechazo del lote completo (`FAILED`) queda reservado a errores de archivo que impiden interpretarlo (formato, encabezados estructurales, checksum, hash, archivo vacío).
- La confirmación persiste efectos con una transacción por registro: un fallo técnico en una fila se registra en esa fila (`PROCESSING_ERROR`, novedad `TECH_001`) y el lote continúa; el cierre del lote actualiza totales al final.
- La descarga de rechazados (`GET /api/v1/novelties/csv` filtrable por lote, con las columnas de diagnóstico de ADR-027) produce un archivo corregible que puede recargarse como carga parcial (solo los corregidos).
- Códigos de novedad aplicables a importación: `CSV_002` (duplicado en archivo), `CSV_003`/`CSV_004` (columna o valor obligatorio), `CSV_005` (formato), `CLS_001`/`CLS_002` (prescripción/clasificación), `ANX_001` (producto inexistente en Anexo; el ítem se conserva y es reprocesable automáticamente al crear el producto, ADR-024), `TECH_001` (error técnico reprocesable). Recargar un registro corregido cierra sus novedades activas (`active = false`) con auditoría `NOVELTY_RESOLVED`; nunca se elimina historial.
- Reprocesamiento sin nueva carga (ADR-027 §8): automático para causas internas determinables (Anexo Tarifario, resolución MIPRES); manual mediante `POST /api/v1/authorization-items/:id/reprocess` con permiso atómico `authorizations.reprocess`.

## Aceptación

- misma carga repetida no duplica;
- concurrencia sobre la misma llave no duplica;
- cada fila tiene código de resultado estable;
- se puede consultar progreso y reporte paginado;
- confirmación es transaccional.
- actualización explícita, auditoría, consumo de la fila e idempotencia confirman o revierten como una sola unidad.
- archivo parcialmente inválido: las filas válidas se confirman sin rollback y las inválidas quedan individualmente identificadas y descargables (ADR-027).
- recargar solo los registros corregidos los procesa sin duplicar los ya confirmados ni alterar los demás lotes.
