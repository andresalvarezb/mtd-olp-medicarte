# Contrato de datos de importacion de autorizaciones

**Estado:** ACCEPTED para Fase 2

## Alcance

Este contrato congela el tratamiento tecnico del archivo de autorizaciones. Solo cuatro columnas tienen semantica de negocio en el alcance actual. Las demas columnas se conservan como evidencia de origen y no habilitan validaciones o decisiones de negocio adicionales.

## Formato del archivo

- Formatos admitidos: CSV y XLSX.
- Se procesa la primera hoja de un XLSX.
- La primera fila contiene encabezados exactos, sensibles a mayusculas/minusculas despues de retirar BOM y espacios externos.
- Todos los encabezados deben tener nombre y no pueden repetirse.
- Las filas completamente vacias se omiten.
- Las columnas desconocidas se conservan como evidencia.
- Una celda se conserva en JSON como `string`, `number`, `boolean`, fecha ISO 8601 o `null`. Otros valores legibles se serializan como texto JSON.
- La evidencia conserva el valor tecnico leido; no se convierte en dato clinico tipado por inferencia.

## Normalizacion comun de negocio

`normalizar(valor)` convierte escalares a texto, aplica `trim`, mayusculas y colapso de espacios consecutivos. `null`, ausencia o texto vacio producen una cadena vacia.

## Diccionario definitivo del alcance actual

| Columna                  | Tipo de entrada       | Obligatoria | Normalizacion                          | Validacion/uso                                                                                                |
| ------------------------ | --------------------- | ----------: | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CODEPS`                 | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `NUMERO_AUTORIZACION`    | Escalar textualizable |          Si | `normalizar`                           | No vacio; maximo 250 caracteres normalizados; primer componente de llave.                                     |
| `TIP_DOCUMENTO`          | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `NUM_DOCUMENTO`          | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `NOMBRE_PACIENTE`        | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `NUMERO_TELEFONO`        | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `COD_CUPS_PRINCIPAL`     | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `CUPS_PRINCIPAL`         | Escalar textualizable |          Si | `normalizar`                           | No vacio; igualdad exacta con `MEDICAMENTOS NO POS` produce `NO_PBS`; cualquier otro valor produce `PBS`.     |
| `COD_COMERCIAL`          | Escalar textualizable |          Si | `normalizar`                           | No vacio; maximo 250 caracteres normalizados; alimenta `codigo_medicamento` y el segundo componente de llave. |
| `CUMS`                   | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `NIT_PRESTADOR`          | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `NOMBRE_PRESTADOR`       | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `COD_CUPS_AUTORIZADO`    | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `CUPS_AUTORIZADO`        | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `CANTIDAD`               | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion numerica o semantica.                                                                          |
| `DOSIS`                  | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion numerica o semantica.                                                                          |
| `FECHA_ASIGNACION`       | Escalar de origen     |          No | Fechas XLSX se preservan como ISO 8601 | Sin validacion temporal o semantica.                                                                          |
| `FECHA_FINAL_VIGENCIA`   | Escalar de origen     |          No | Fechas XLSX se preservan como ISO 8601 | Sin validacion temporal o semantica.                                                                          |
| `ESTADO_AUTORIZACION`    | Escalar textualizable |          Si | `normalizar`                           | No vacio; `5` produce `ENABLED`; cualquier otro valor produce `BLOCKED_SOURCE_STATUS` y no rechaza la fila.   |
| `OBS_AUTORIZACION`       | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `MEDICO_REMITENTE`       | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `CMNT`                   | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `_Id`                    | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `FPRO`                   | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion semantica.                                                                                     |
| `VALOR CUOTA MODERADORA` | Escalar de origen     |          No | Ninguna; preservar evidencia           | Sin validacion numerica o monetaria.                                                                          |

## Llave e idempotencia

La identidad global es la pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL`. La representacion tecnica escapa `\` y `:` en cada componente y los separa con `:`; su longitud maxima es 511 caracteres.

Para una llave repetida dentro del archivo, la primera aparicion conserva su resultado normal y la segunda aparicion y posteriores producen `DUPLICATE_IN_FILE`. Una llave existente produce `EXISTING_ITEM_REVIEW_REQUIRED` y no se actualiza automaticamente. La actualizacion explicita solo se permite en `READY_TO_DISPENSE`, reemplaza la evidencia y reevalua las cuatro columnas de negocio, recalcula `operation_status` y se bloquea desde `DISPENSATION_REPORTED`.

La actualizacion conserva `READY_TO_DISPENSE` solo para `ENABLED + PBS + NOT_APPLICABLE` o `ENABLED + NO_PBS + CONFIRMED`; cualquier otra combinacion queda `BLOCKED`. La pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` debe coincidir con la llave existente y sus componentes no cambian. En Fase 2, `NO_PBS + ENABLED + PENDING` queda bloqueado sin consulta externa.

La auditoria de la actualizacion explicita referencia la fila de evidencia anterior y la nueva, conserva sus hashes SHA-256 y compara `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `CUPS_PRINCIPAL` y `ESTADO_AUTORIZACION` normalizados. El registro idempotente se enlaza por ID y hashes tecnicos; su respuesta persistida no contiene `sourceData`. La evidencia cruda permanece en `import_rows` y `authorization_items` para no duplicar datos sensibles.

## Catalogo estable de resultados

| Codigo                          | Significado                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `ROW_VALID`                     | Fila valida y elegible para crear un item.                                      |
| `MISSING_REQUIRED_FIELD`        | Falta un encabezado obligatorio o un valor obligatorio.                         |
| `INVALID_FIELD_FORMAT`          | Archivo, encabezado o valor no cumple el formato tecnico.                       |
| `DUPLICATE_IN_FILE`             | La fila es la segunda aparicion o una posterior de la llave dentro del archivo. |
| `EXISTING_ITEM_REVIEW_REQUIRED` | La llave existe y requiere revision humana.                                     |
| `EXPLICIT_UPDATE_NOT_ALLOWED`   | La actualizacion explicita no esta permitida en el estado actual.               |
| `ITEM_CREATED`                  | La confirmacion creo el item.                                                   |
| `ITEM_UPDATED`                  | La actualizacion explicita termino correctamente.                               |
| `PROCESSING_ERROR`              | Fallo tecnico estable sin exponer detalles internos.                            |

## Prohibiciones

- No inferir tipos clinicos, monetarios, documentales o temporales para columnas de evidencia.
- No agregar obligatoriedad o reglas semanticas a las 21 columnas de evidencia sin una decision documentada.
- No sustituir `COD_COMERCIAL` por `CUMS` o `COD_CUPS_AUTORIZADO` en la llave.
