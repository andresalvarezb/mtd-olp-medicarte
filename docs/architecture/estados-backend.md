# Catalogo de estados del backend

## Alcance

Desde la migracion `0018_estados_espanol`, los estados de negocio y de
procesamiento que se persisten o se exponen por la API usan identificadores
ASCII en espanol. La API ya no acepta los valores anteriores en ingles.

Los nombres de columnas (`status`, `outcome`, `operation_status`, etc.) no
cambian. Tampoco cambian los codigos de error, codigos de resultado por fila,
tipos de evento, nombres de colas ni tipos de operacion: esos son
identificadores tecnicos estables.

## Estados de negocio

| Dimension                          | Valores vigentes                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `enablement_status`                | `HABILITADO`, `BLOQUEADO_POR_ESTADO_ORIGEN`                                            |
| `direction_status`                 | `NO_APLICA`, `PENDIENTE`, `CONFIRMADO`, `ERROR_DE_CONSULTA`                            |
| `operation_status`                 | `BLOQUEADO`, `LISTO_PARA_DISPENSAR`, `DISPENSACION_REPORTADA`, `DISPENSADO`, `VENCIDO` |
| `audit_status`                     | `NO_INICIADO`, `LISTO`, `EN_REVISION`, `RECHAZADO`, `APROBADO`                         |
| `admission_status`                 | `NO_LISTO`, `LISTO`                                                                    |
| `tariff_membership_status`         | `NO_EVALUADO`, `LISTADO`, `NO_LISTADO`                                                 |
| `application_site_status`          | `PENDIENTE_ASIGNACION`, `ASIGNADO`                                                     |
| `application_date_status` (filtro) | `FALTANTE`, `PRESENTE`                                                                 |

Flujo principal de operacion:

```text
LISTO_PARA_DISPENSAR -> DISPENSACION_REPORTADA -> DISPENSADO
```

Flujo de auditoria:

```text
NO_INICIADO -> LISTO -> EN_REVISION -> APROBADO | RECHAZADO
RECHAZADO -> EN_REVISION
```

## Estados de procesamiento

| Recurso                        | Valores vigentes                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `import_batches.status`        | `CARGADO`, `VALIDANDO`, `LISTO_PARA_CONFIRMAR`, `CONFIRMANDO`, `COMPLETADO`, `FALLIDO`, `CANCELADO`, `REVIRTIENDO`, `REVERTIDO` |
| `bulk_update_batches.status`   | `CARGADO`, `EN_COLA`, `PROCESANDO`, `COMPLETADO`, `FALLIDO`                                                                     |
| `tariff_annex_imports.status`  | `CARGADO`, `VALIDANDO`, `COMPLETADO`, `FALLIDO`                                                                                 |
| `notifications.status`         | `PENDIENTE`, `ENVIADO`, `FALLIDO`, `OMITIDO`                                                                                    |
| `audit_reviews.status`         | `EN_REVISION`, `APROBADO`, `RECHAZADO`                                                                                          |
| `pending_user_requests.status` | `PENDIENTE`, `APROBADO`, `RECHAZADO`                                                                                            |
| `mipres_checks.outcome`        | `PENDIENTE`, `CONFIRMADO`, `ERROR_DE_CONSULTA`                                                                                  |
| `outbox_events.status`         | `PENDIENTE`, `DESPACHADO`, `PROCESADO`, `FALLIDO`                                                                               |

Las respuestas de jobs usan las mismas palabras cuando el campo es `status` u
`outcome`. Las respuestas de aceptacion de la sonda de foundation usan
`status: ACEPTADO`; el endpoint de salud conserva `status: ok` como indicador
tecnico estandar.

## Migracion y clientes

`0018_estados_espanol` convierte las filas existentes y actualiza las
restricciones de PostgreSQL. `0018` y las migraciones posteriores normalizan
tambien las respuestas cacheadas en `job_results`, `idempotency_records` y las
clasificaciones JSON de `import_rows`. Se ejecutan con:

```bash
pnpm db:migrate
```

Los clientes deben actualizar sus filtros y comparaciones al catalogo vigente.
Enviar un estado antiguo en ingles produce un error de validacion; no se
mantiene un alias silencioso para evitar que dos representaciones convivan en
la fuente de verdad.
