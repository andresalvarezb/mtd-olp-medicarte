# Descargas y actualizaciones operativas (MEDICARTE y OLP)

Referencia de operación para los flujos masivos de la Fase 4/5 (SPEC-013, ADR-022). Los dos actores trabajan directamente en la aplicación web; no requieren clientes API.

## Matriz de operaciones

Cada tipo de operación fija actor, permiso y la única columna que puede modificar (contrato cerrado en `packages/contracts`). El backend rechaza con `403` cualquier intento cruzado entre actores.

| Operación                      | Actor     | Permiso                              | Columna modificable                       | Vista en la aplicación |
| ------------------------------ | --------- | ------------------------------------ | ----------------------------------------- | ---------------------- |
| `ASSIGN_DISPENSATION_LOCATION` | MEDICARTE | `bulk_updates.dispensation_location` | `lugar_dispensacion` + `fecha_programada` | Puntos de aplicación   |
| `REPORT_DISPENSATION_DATE`     | OLP       | `bulk_updates.dispensation_date`     | `fecha_dispensacion`                      | Logística OLP          |
| `REPORT_APPLICATION_DATE`      | MEDICARTE | `bulk_updates.application_date`      | `fecha_aplicacion`                        | Puntos de aplicación\* |

\*La carga de `fecha_aplicacion` reutiliza el mismo mecanismo; su vista dedicada puede habilitarse con el mismo componente.

## Flujo estándar (los cuatro pasos)

1. **Descargar la base.** Botón "Exportar base (CSV)" o "Exportar Excel" en la vista del rol. La descarga es on-demand, no deja copia en la plataforma y queda auditada. La base de OLP (`REPORT_DISPENSATION_DATE`) solo incluye registros con `lugar_dispensacion` ya asignado por MEDICARTE; los pendientes de asignación se omiten. La descarga incluye la columna `authorization_key` que sirve como llave para la carga.
2. **Diligenciar el archivo.** Mantener exactamente las columnas de la plantilla (ver tabla siguiente). Para lugar y fecha de dispensación la única llave es `authorization_key` (pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` que viene en la descarga).
3. **Cargar el archivo.** Botón de carga en la misma vista. La plataforma responde con un número de lote y procesa en segundo plano; la tabla se refresca sola al terminar.
4. **Verificar el resultado.** El resumen del lote muestra procesadas, actualizadas, sin cambio y rechazadas; las filas rechazadas listan su causal.

## Archivos de carga

Formato CSV o XLSX, máximo 20 MB, sin columnas adicionales, alias ni campos arbitrarios.

| Operación                      | Encabezados exactos (fila 1)                              | Formato del valor                  |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------- |
| `ASSIGN_DISPENSATION_LOCATION` | `authorization_key,lugar_dispensacion,fecha_programada`   | lugar no vacío; fecha `YYYY-MM-DD` |
| `REPORT_DISPENSATION_DATE`     | `authorization_key,fecha_dispensacion`                    | fecha `YYYY-MM-DD`                 |
| `REPORT_APPLICATION_DATE`      | `numero_autorizacion,codigo_medicamento,fecha_aplicacion` | fecha `YYYY-MM-DD`                 |

`lugar_dispensacion` es texto libre: el sistema exige valor no vacío y normaliza espacios; no valida estructura de dirección.

## Notificaciones por correo

Las notificaciones se generan mediante el outbox transaccional y el worker existente. Los
destinatarios se configuran en `/administracion` por organización lógica y tipo de evento; el
remitente funcional se configura en la misma vista. Las credenciales de Gmail (`GMAIL_SENDER`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_PRIVATE_KEY`) siguen siendo secretos de infraestructura.

| Evento                                     | Organización destinataria                             |
| ------------------------------------------ | ----------------------------------------------------- |
| Autorizaciones disponibles                 | MEDICARTE (y OLP, según el aviso operativo existente) |
| Rechazos/omisiones de validación de cargue | COMPENSAR                                             |
| Punto de aplicación registrado             | OLP                                                   |
| Fecha de dispensación registrada           | MTD y MEDICARTE                                       |
| Fecha de aplicación registrada             | MTD                                                   |

Cada evento conserva lote o ítem, destinatario, destinatarios concretos, remitente, estado,
intentos e identificador del proveedor en `notifications`. Las claves idempotentes incluyen el
evento, ítem, versión operativa y organización destinataria. En desarrollo sin credenciales Gmail
se utiliza el adaptador fake y el identificador `fake-*`; no representa entrega externa.

## Precondiciones por operación

- Las tres operaciones exigen un ítem visible para la organización y `operation_status` distinto de `BLOCKED`.
- `ASSIGN_DISPENSATION_LOCATION`: ítem en `READY_TO_DISPENSE` o posterior.
- `REPORT_DISPENSATION_DATE`: `lugar_dispensacion` definido (asignado previamente por MEDICARTE) y estado `READY_TO_DISPENSE` o `DISPENSATION_REPORTED`.
- `REPORT_APPLICATION_DATE`: `lugar_dispensacion` definido y auditoría no aprobada. Una vez `audit_status = APPROVED` el campo queda inmutable y la fila se rechaza con `OPERATION_NOT_ALLOWED`.

## Cadena operativa de referencia

```text
MEDICARTE asigna lugar -> OLP reporta fecha de dispensación -> MEDICARTE reporta fecha de aplicación
        (READY_TO_DISPENSE)         (DISPENSATION_REPORTED)         (ambas fechas derivan audit_status = READY)
```

Con ambas fechas el registro queda habilitado para revisión del auditor MTD; solo una decisión humana produce `APPROVED` e ingresa el registro al consolidado (SPEC-006).

## Ciclo de vida del lote

`UPLOADED -> QUEUED -> PROCESSING -> COMPLETED | FAILED`

- Una fila inválida no revierte las demás; las filas válidas se aplican.
- Reprocesar el mismo archivo no duplica efectos ni notificaciones (idempotencia por lote y por fila).
- El resultado por fila conserva causal estable; el reporte es descargable y no habilita modificar el lote.
- El archivo fuente se nulifica al terminar; el staging y la auditoría permanecen consultables.

## Causales de rechazo por fila

`MISSING_BUSINESS_KEY`, `DUPLICATE_KEY_IN_FILE`, `AUTHORIZATION_ITEM_NOT_FOUND`, `FORBIDDEN_ITEM_SCOPE`, `OPERATION_NOT_ALLOWED`, `MISSING_VALUE`, `INVALID_VALUE_FORMAT`, `INVALID_OPERATION_STATE`, `VERSION_CONFLICT`, `UNCHANGED_VALUE`.

`UNCHANGED_VALUE` se reporta como procesada sin actualización y no se considera error.

## Trazabilidad

Cada fila válida incrementa la versión operativa del ítem y registra: valor anterior, valor nuevo, actor, organización, lote, fila y fecha. Un cambio de lugar de dispensación genera notificación nueva a OLP después del commit.

## Apéndice: equivalencia API (referencia técnica)

La UI consume estos endpoints; quedan disponibles para integraciones:

- `GET /api/v1/operational-exports/authorization-items?operationType=...&format=csv|xlsx`
- `POST /api/v1/bulk-updates` (multipart: `operationType` + `file`, header `Idempotency-Key`)
- `GET /api/v1/bulk-updates/{batchId}` · `/rows` · `/report?format=csv|xlsx`

Documentación interactiva: `GET /api/v1/docs` (Swagger UI) y contrato en `GET /api/v1/openapi.json`. Toda petición requiere `Authorization: Bearer <JWT>` y `X-Organization-Id`.
