# SPEC-001 — Importación de autorizaciones

**Fase:** 2

## Objetivo

Cargar CSV/XLSX de forma idempotente, conservar evidencia por fila y confirmar ítems válidos.

## Entrada mínima conocida

- `NUMERO_AUTORIZACION`
- `COD_COMERCIAL`
- `CUPS_PRINCIPAL`
- `ESTADO_AUTORIZACION`

## Diccionario F2 recibido

El archivo de autorizaciones recibido contiene estas 25 columnas. Las cuatro columnas marcadas como de negocio tienen validación explícita en Fase 2. Las demás se conservan en la evidencia de la fila y del ítem como valores escalares del archivo; no se les asignan obligatoriedad ni reglas semánticas adicionales hasta que exista una decisión documentada.

El contrato normativo de tipo, obligatoriedad, normalización, validaciones, llave y causales está en `../contracts/AUTHORIZATION_IMPORT_DATA_DICTIONARY.md`. Esta sección es su resumen funcional y no debe evolucionar de forma independiente.

| Columna                  | F2        | Tratamiento                                                                                              |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------- |
| `CODEPS`                 | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `NUMERO_AUTORIZACION`    | Negocio   | Obligatoria; se recorta, convierte a mayúsculas y colapsa espacios para la llave.                        |
| `TIP_DOCUMENTO`          | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `NUM_DOCUMENTO`          | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `NOMBRE_PACIENTE`        | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `NUMERO_TELEFONO`        | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `COD_CUPS_PRINCIPAL`     | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `CUPS_PRINCIPAL`         | Negocio   | Obligatoria; normalización técnica y clasificación por igualdad exacta.                                  |
| `COD_COMERCIAL`          | Negocio   | Obligatoria; se recorta, convierte a mayúsculas y colapsa espacios para la llave y `codigo_medicamento`. |
| `CUMS`                   | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `NIT_PRESTADOR`          | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `NOMBRE_PRESTADOR`       | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `COD_CUPS_AUTORIZADO`    | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `CUPS_AUTORIZADO`        | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `CANTIDAD`               | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `DOSIS`                  | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `FECHA_ASIGNACION`       | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `FECHA_FINAL_VIGENCIA`   | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `ESTADO_AUTORIZACION`    | Negocio   | Obligatoria; el valor normalizado `5` habilita y cualquier otro valor bloquea por estado de origen.      |
| `OBS_AUTORIZACION`       | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `MEDICO_REMITENTE`       | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `CMNT`                   | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `_Id`                    | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `FPRO`                   | Evidencia | Se conserva sin validación semántica adicional.                                                          |
| `VALOR CUOTA MODERADORA` | Evidencia | Se conserva sin validación semántica adicional.                                                          |

La lista suministrada contiene 25 columnas; F2 no inventa una columna adicional. Encabezados desconocidos, si aparecen, también se conservan como evidencia sin convertirlos en reglas de negocio.

## Catálogo estable de resultados por fila

| Código                          | Uso                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `ROW_VALID`                     | Fila validada y elegible para confirmación de un ítem nuevo.                        |
| `MISSING_REQUIRED_FIELD`        | Falta una de las cuatro columnas de negocio o su valor.                             |
| `INVALID_FIELD_FORMAT`          | El archivo o valor no cumple el formato técnico definido para F2.                   |
| `DUPLICATE_IN_FILE`             | La llave aparece más de una vez dentro del mismo archivo.                           |
| `EXISTING_ITEM_REVIEW_REQUIRED` | La llave ya existe y requiere verificación humana; no se actualiza automáticamente. |
| `EXPLICIT_UPDATE_NOT_ALLOWED`   | Una actualización explícita fue intentada fuera de `READY_TO_DISPENSE`.             |
| `ITEM_CREATED`                  | La fila válida creó un ítem durante la confirmación.                                |
| `ITEM_UPDATED`                  | Una actualización explícita autorizada terminó correctamente.                       |
| `PROCESSING_ERROR`              | Error técnico estable de procesamiento, sin exponer la excepción interna.           |

## Reglas

- `authorization_key = normalizar(NUMERO_AUTORIZACION) + normalizar(COD_COMERCIAL)`.
- `COD_COMERCIAL` alimenta `codigo_medicamento`.
- Un duplicado dentro del archivo no crea dos ítems.
- Si la llave ya existe, la fila se reporta para verificación humana y no se actualiza automáticamente.
- Debe existir una acción explícita de actualización.
- Solo se habilita si `operation_status = READY_TO_DISPENSE`.
- Se bloquea para `DISPENSATION_REPORTED`, `DISPENSED` y estados posteriores.
- Los mensajes de excepción técnicos no son causales de negocio.

## Flujo

`UPLOADED -> VALIDATING -> READY_TO_CONFIRM -> CONFIRMING -> COMPLETED`.
Excepciones: `FAILED`, `CANCELLED`.

## Persistencia

`import_batches`, `import_rows`, `validation_errors`, `authorization_items`, `audit_events`.

## Aceptación

- misma carga repetida no duplica;
- concurrencia sobre la misma llave no duplica;
- cada fila tiene código de resultado estable;
- se puede consultar progreso y reporte paginado;
- confirmación es transaccional.
