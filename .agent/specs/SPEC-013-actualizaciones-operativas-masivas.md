# SPEC-013 — Descargas y actualizaciones operativas masivas

**Fases:** 4 y 5

## Objetivo

Permitir descargas completas según alcance y tres actualizaciones masivas seguras mediante el pipeline genérico definido en ADR-022.

## Tipos y contratos de columnas

| Tipo                           | Actor     | Encabezados exactos                              |
| ------------------------------ | --------- | ------------------------------------------------ |
| `ASSIGN_DISPENSATION_LOCATION` | MEDICARTE | `authorization_key,lugar_dispensacion`           |
| `REPORT_DISPENSATION_DATE`     | OLP       | `authorization_key,fecha_dispensacion`           |
| `REPORT_APPLICATION_DATE`      | MEDICARTE | `authorization_key,fecha_aplicacion_medicamento` |

No se aceptan columnas adicionales, alias ni campos arbitrarios. Para las tres operaciones la única llave de negocio es `authorization_key`: la pareja normalizada `numero_autorizacion + codigo_medicamento` (separador `:`, con escape de `\` y `:`) que entrega la descarga operativa. `fecha_aplicacion_medicamento` es el nombre del archivo y mapea exclusivamente al campo persistido `fecha_aplicacion DATE`. `lugar_dispensacion` es texto libre: el sistema solo exige valor no vacío y normalización de espacios; no valida estructura de dirección. Las fechas usan el formato canónico `YYYY-MM-DD`; no se inventan restricciones temporales adicionales mientras no exista una decisión de negocio. Este cambio versiona el contrato (`BULK_UPDATE_CONTRACT_VERSION = 3`).

## Pipeline

1. La API valida autenticación, permiso del tipo, formato, encabezados, tamaño máximo de 20 MB e `Idempotency-Key`.
2. Persiste `bulk_update_batch` y el archivo fuente en `bulk_update_source_files.content BYTEA` dentro de PostgreSQL.
3. Escribe outbox; BullMQ recibe solo `batch_id`, `correlation_id` y versión del contrato.
4. El worker recupera el archivo, crea staging en `bulk_update_rows` y valida cada fila.
5. Por fila valida llave, existencia, alcance organizacional, permiso, precondición y valor.
6. Cada fila válida actualiza exclusivamente el campo del tipo, incrementa versión y registra historial/auditoría/outbox en una transacción.
7. El lote publica totales de filas procesadas, actualizadas, sin cambio y rechazadas; el resultado por fila conserva causal estable.
8. El binario temporal se nulifica al terminar, con la misma política de las importaciones F2; staging y resultados permanecen auditables.

Una fila no válida no revierte otras filas válidas. Reprocesar el mismo lote o una misma fila no duplica el efecto lógico ni la notificación.

## Causales mínimas estables

- `INVALID_FILE_FORMAT`
- `FILE_TOO_LARGE`
- `INVALID_HEADERS`
- `MISSING_BUSINESS_KEY`
- `DUPLICATE_KEY_IN_FILE`
- `AUTHORIZATION_ITEM_NOT_FOUND`
- `FORBIDDEN_ITEM_SCOPE`
- `OPERATION_NOT_ALLOWED`
- `MISSING_VALUE`
- `INVALID_VALUE_FORMAT`
- `INVALID_OPERATION_STATE`
- `VERSION_CONFLICT`
- `UNCHANGED_VALUE`

`UNCHANGED_VALUE` se reporta como procesada sin actualización y no emite evento. Los mensajes humanos pueden evolucionar; los códigos no cambian sin versionar el contrato.

`VERSION_CONFLICT` también evita actualizar cuando el prefijo de protección contra fórmulas de una hoja de cálculo puede representar dos llaves existentes; el caso se remite a revisión humana.

## Precondiciones

- Las tres operaciones exigen un ítem visible para la organización y `operation_status` no igual a `BLOQUEADO`.
- `ASSIGN_DISPENSATION_LOCATION` requiere que el ítem haya alcanzado `LISTO_PARA_DISPENSAR` o un estado operacional posterior.
- `REPORT_DISPENSATION_DATE` requiere `lugar_dispensacion` definido y estado `LISTO_PARA_DISPENSAR` o `DISPENSACION_REPORTADA`.
- `REPORT_APPLICATION_DATE` requiere `lugar_dispensacion` definido y `audit_status` distinto de `APROBADO` (equivalente a `operation_status` distinto de `DISPENSADO`).
- Una corrección por el mismo actor autorizado se permite y siempre crea historial si cambia el valor.
- `fecha_aplicacion` puede corregirse siempre que la auditoría del registro no esté aprobada; una vez `audit_status = APROBADO` el campo queda inmutable y la fila se rechaza con `OPERATION_NOT_ALLOWED`.

Estas precondiciones ordenan el flujo solicitado; no validan automáticamente soportes ni deciden auditoría.

## Descargas

- MEDICARTE descarga la base completa de registros listos o posteriores dentro de su alcance, para asignar `lugar_dispensacion` y reportar `fecha_aplicacion`.
- OLP descarga únicamente los registros con `lugar_dispensacion` ya asignado por MEDICARTE, incluyendo el valor vigente y la `authorization_key` para el reporte de `fecha_dispensacion`; los registros pendientes de asignación se omiten.
- “Completa” significa todos los campos disponibles que el permiso de lectura y la política de datos sensibles permitan; nunca omite silenciosamente la seguridad por columna.
- CSV/XLSX se genera on-demand, no se conserva copia y se auditan actor, organización, filtros, formato, columnas efectivas, cantidad y resultado.

## API

- `GET /api/v1/operational-exports/authorization-items?operationType=ASSIGN_DISPENSATION_LOCATION|REPORT_DISPENSATION_DATE|REPORT_APPLICATION_DATE&format=csv|xlsx`
- `POST /api/v1/bulk-updates` multipart con `operationType` y `file`
- `GET /api/v1/bulk-updates/:batchId`
- `GET /api/v1/bulk-updates/:batchId/rows`
- `GET /api/v1/bulk-updates/:batchId/report?format=csv|xlsx`

`POST` responde `202` con `batchId`, estado y URL de consulta. Consultas y reportes vuelven a validar organización, permiso y alcance. El reporte de resultados no habilita modificar el lote.

`operationType` es obligatorio en la descarga para aplicar el alcance de etapa y actor. No reduce las columnas consultables: la descarga conserva la vista completa permitida, mientras cada carga queda limitada a `authorization_key` + una columna mutable.

## Aceptación

- Cada actor solo puede ejecutar sus tipos y cada tipo solo modifica su columna.
- Columnas adicionales son rechazadas por backend aunque el frontend no las muestre.
- Un ítem fuera de alcance se rechaza sin revelar datos sensibles.
- Antes/después, actor, organización, lote, fila y fecha quedan trazables.
- Una modificación del lugar genera una notificación nueva a OLP solo después del commit.
- Descargas de OLP contienen `lugar_dispensacion`; las de MEDICARTE contienen la vista completa permitida.
- Lotes duplicados, jobs repetidos y concurrencia por la misma llave producen un único efecto por versión.
