# Descargas y actualizaciones operativas (MEDICARTE y OLP)

Referencia de operación para los flujos masivos de la Fase 4/5 (SPEC-013, ADR-022). Los dos actores trabajan directamente en la aplicación web; no requieren clientes API.

## Matriz de operaciones

Cada tipo de operación fija actor, permiso y la única columna que puede modificar (contrato cerrado en `packages/contracts`). El backend rechaza con `403` cualquier intento cruzado entre actores.

| Operación                      | Actor     | Permiso                              | Columna modificable                       | Vista en la aplicación |
| ------------------------------ | --------- | ------------------------------------ | ----------------------------------------- | ---------------------- |
| `ASSIGN_DISPENSATION_LOCATION` | MEDICARTE | `bulk_updates.dispensation_location` | `lugar_dispensacion` + `fecha_programada` | Puntos de aplicación   |
| `REPORT_DISPENSATION_DATE`     | OLP       | `bulk_updates.dispensation_date`     | `fecha_dispensacion`                      | Logística OLP          |
| `REPORT_APPLICATION_DATE`      | MEDICARTE | `bulk_updates.application_date`      | `fecha_aplicacion`                        | Puntos de aplicación\* |
| `ASSIGN_PURCHASE_ORDER`        | MTD       | `bulk_updates.purchase_order`        | `orden_compra`                            | Órdenes de compra      |

\*La carga de `fecha_aplicacion` reutiliza el mismo mecanismo; su vista dedicada puede habilitarse con el mismo componente.

## Flujo estándar (los cuatro pasos)

1. **Descargar la base.** Botón "Exportar base (XLSX)" en la vista del rol. La descarga es on-demand, no deja copia en la plataforma y queda auditada. Cada base solo incluye registros habilitados para su siguiente etapa y conserva los campos operativos ya registrados, incluida `ORDEN_COMPRA`. La descarga incluye la columna `authorization_key` que sirve como llave para la carga.
2. **Diligenciar el archivo.** Mantener exactamente las columnas de la plantilla (ver tabla siguiente). Para lugar y fecha de dispensación la única llave es `authorization_key` (pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` que viene en la descarga).
3. **Cargar el archivo.** Botón de carga en la misma vista. La plataforma responde con un número de lote y procesa en segundo plano; la tabla se refresca sola al terminar.
4. **Verificar el resultado.** El resumen del lote muestra procesadas, actualizadas, sin cambio y rechazadas; las filas rechazadas listan su causal y permiten descargar únicamente las novedades de ese lote en XLSX.

## Archivos de carga

Formato XLSX (`.xlsx`) únicamente, máximo 20 MB, sin columnas adicionales, alias ni campos arbitrarios.

| Operación                      | Encabezados exactos (fila 1)                              | Formato del valor                  |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------- |
| `ASSIGN_DISPENSATION_LOCATION` | `CLAVE_AUTORIZACION,LUGAR_DISPENSACION,FECHA_PROGRAMADA` | lugar no vacío; fecha `YYYY-MM-DD` |
| `ASSIGN_PURCHASE_ORDER`        | `CLAVE_AUTORIZACION,ORDEN_COMPRA`                     | orden no vacía                         |
| `REPORT_DISPENSATION_DATE`     | `authorization_key,fecha_dispensacion`                    | fecha `YYYY-MM-DD`                 |
| `REPORT_APPLICATION_DATE`      | `CLAVE_AUTORIZACION,FECHA_APLICACION,COD_AUTORIZACION_MEDICARTE` | fecha `YYYY-MM-DD`                 |

`lugar_dispensacion` es texto libre: el sistema exige valor no vacío y normaliza espacios; no valida estructura de dirección.

## Órdenes de compra

La vista `/ordenes-compra` y su descarga XLSX solo muestran registros que MEDICARTE
ya completó con `LUGAR_DISPENSACION` y `FECHA_PROGRAMADA`, y que todavía no tienen
`ORDEN_COMPRA`. Esta etapa no depende de `COD_AUTORIZACION_MEDICARTE`; ese campo
se exige posteriormente en `/soportes`. La carga para asignar la orden utiliza exactamente:
`CLAVE_AUTORIZACION` y `ORDEN_COMPRA`.

Después de asignar `ORDEN_COMPRA`, el registro aparece en `/logistica-olp` para que
OLP informe `FECHA_DISPENSACION`.

## Notificaciones

Las notificaciones automáticas, los reportes diarios y el correo no forman parte del alcance
vigente de este flujo. El resultado del lote y la bandeja transversal de novedades son la fuente
operativa para consultar y descargar los registros rechazados.

## Precondiciones por operación

- Las operaciones exigen un ítem visible para la organización y `operation_status` distinto de `BLOCKED`.
- `ASSIGN_DISPENSATION_LOCATION`: ítem en `READY_TO_DISPENSE` o posterior.
- `ASSIGN_PURCHASE_ORDER`: `lugar_dispensacion` y `fecha_programada` definidos, sin `orden_compra` previa.
- `REPORT_DISPENSATION_DATE`: `lugar_dispensacion` y `orden_compra` definidos, y estado `READY_TO_DISPENSE` o `DISPENSATION_REPORTED`.
- `REPORT_APPLICATION_DATE`: `fecha_dispensacion` definida, auditoría no aprobada y archivo con `FECHA_APLICACION` y `COD_AUTORIZACION_MEDICARTE`. Una vez `audit_status = APPROVED` el campo queda inmutable y la fila se rechaza con `OPERATION_NOT_ALLOWED`.

## Cadena operativa de referencia

```text
MEDICARTE asigna lugar/fecha -> MTD asigna orden -> OLP reporta dispensación -> MEDICARTE reporta aplicación
       (READY_TO_DISPENSE)       (READY_TO_DISPENSE)      (DISPENSATION_REPORTED)   (ambas fechas derivan audit_status = READY)
```

Con ambas fechas el registro queda habilitado para revisión del auditor MTD; solo una decisión humana produce `APPROVED` e ingresa el registro al consolidado (SPEC-006).

## Ciclo de vida del lote

`UPLOADED -> QUEUED -> PROCESSING -> COMPLETED | FAILED`

- Una fila inválida no revierte las demás; las filas válidas se aplican (ADR-027). `FAILED` queda reservado a errores de archivo que impiden interpretarlo; el resumen del lote muestra la causa del rechazo.
- Reprocesar el mismo archivo no duplica efectos ni notificaciones (idempotencia por lote y por fila).
- El resultado por fila conserva causal estable; el reporte es descargable y no habilita modificar el lote.
- El archivo fuente se nulifica al terminar; el staging y la auditoría permanecen consultables.

## Resultados y errores por registro (ADR-027)

Después de cada carga el resumen del lote informa: total recibido, procesados correctamente, rechazados, actualizados y sin cambio cuando aplique, más el estado general del lote. Desde allí:

1. **Consultar/ver errores:** vista **Novedades** (`/novedades`), filtrable por autorización, documento del paciente, etapa, tipo de error, estado (pendiente/resuelta) y lote, con acceso según permisos del rol.
2. **Descargar errores:** cada etapa ofrece `Descargar novedades del lote (XLSX)` para el lote seleccionado. La descarga usa la bandeja transversal `novelties` y contiene únicamente las filas rechazadas de ese lote, con las columnas originales de cada fila más `ESTADO_PROCESAMIENTO`, `ETAPA_ERROR`, `CODIGO_ERROR`, `TIPO_ERROR` y `DESCRIPCION_ERROR`.
3. **Corregir y recargar:** el archivo descargado se corrige externamente y se recarga como carga parcial; solo se procesan esos registros y sus novedades previas se cierran automáticamente. Las novedades de otros lotes nunca se incluyen ni se reprocesan.
4. **Reprocesar sin recargar:** si el tipo de error es `REPROCESABLE_INTERNAMENTE` (p. ej. el producto se creó después en el Anexo Tarifario, o fue un conflicto de concurrencia), la acción **Reprocesar** en la novedad re-evalúa el registro contra el estado actual del sistema; no se exige subir el archivo original de nuevo. La revalidación por creación de producto es además automática.
5. **Rechazo de auditoría:** no es un error técnico; se registra con motivo obligatorio y devuelve el registro a su etapa según SPEC-006 (los conceptos `PENDIENTE/APROBADO/RECHAZADO` se conservan).

Los tipos de error son: `CORREGIBLE_POR_CARGUE` (el dato externo debe corregirse y recargarse), `REQUIERE_VALIDACION` (interviene un usuario autorizado) y `REPROCESABLE_INTERNAMENTE` (el dato original sigue siendo válido; basta resolver la condición interna). La bandeja transversal es la única fuente para consultar y descargar novedades de cualquier etapa.

## Causales de rechazo por fila

`MISSING_BUSINESS_KEY`, `DUPLICATE_KEY_IN_FILE`, `AUTHORIZATION_ITEM_NOT_FOUND`, `FORBIDDEN_ITEM_SCOPE`, `OPERATION_NOT_ALLOWED`, `MISSING_VALUE`, `INVALID_VALUE_FORMAT`, `INVALID_OPERATION_STATE`, `VERSION_CONFLICT`, `UNCHANGED_VALUE`.

`UNCHANGED_VALUE` se reporta como procesada sin actualización y no se considera error.

## Trazabilidad

Cada fila válida incrementa la versión operativa del ítem y registra: valor anterior, valor nuevo, actor, organización, lote, fila y fecha. Un cambio de lugar de dispensación genera notificación nueva a OLP después del commit.

## Apéndice: equivalencia API (referencia técnica)

La UI consume estos endpoints; quedan disponibles para integraciones:

- `GET /api/v1/operational-exports/authorization-items?operationType=...&format=xlsx`
- `POST /api/v1/bulk-updates` (multipart: `operationType` + `file`, header `Idempotency-Key`)
- `GET /api/v1/bulk-updates/{batchId}` · `/rows` · `/report?format=xlsx`

Documentación interactiva: `GET /api/v1/docs` (Swagger UI) y contrato en `GET /api/v1/openapi.json`. Toda petición requiere `Authorization: Bearer <JWT>` y `X-Organization-Id`.
