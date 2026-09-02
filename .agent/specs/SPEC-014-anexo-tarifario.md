# SPEC-014 — Anexo Tarifario

**Fase:** transversal. ADR-024, ADR-003, ADR-009, ADR-014, ADR-016, ADR-018, ADR-007.

## Objetivo

Catálogo administrativo de MTD que define los códigos de producto habilitados para que una autorización alcance `READY_TO_DISPENSE`. El código de cruce es `authorization_items.codigo_medicamento` (misma normalización técnica de `COD_COMERCIAL`). No se usan CUM, CUPS, descripción, nombre o principio activo.

## Modelo de datos

- `tariff_annex_products`: `codigo_producto` (único, normalizado), los campos de la plantilla comercial (`tarifa_unidad`, expediente y consecutivo INVIMA, descripciones, laboratorio y tipo de inclusión), `active` (baja lógica), `organization_id`, `created_by`/`updated_by`, `version`, timestamps. La unicidad total permite reactivar sin duplicar.
- `tariff_annex_imports` / `tariff_annex_import_source_files` / `tariff_annex_import_rows`: staging del cargue masivo (patrón ADR-013; fuente temporal `BYTEA`, se nulifica al finalizar).
- `authorization_items` agrega `tariff_membership_status` (`NOT_EVALUATED|LISTED|NOT_LISTED`), `tariff_membership_evaluated_at`, `tariff_rule_version` (`TARIFF-ANNEX-1`). El invariante de base extiende el prerrequisito de `READY_TO_DISPENSE` con `tariff_membership_status = 'LISTED'`.
- Backfill de migración: los ítems preexistentes quedan `LISTED` (evaluados antes de que existiera el Anexo; sin efecto retroactivo).

## API

- `GET /admin/tariff-annex/products` — listado con búsqueda por código y filtro `active` (`tariff_annex.read`).
- `GET /admin/tariff-annex/products/:id` — consulta de un producto (`tariff_annex.read`).
- `POST /admin/tariff-annex/products` — crear; idempotente: activo existente devuelve `PRODUCT_EXISTING`; inactivo existente se reactiva (`PRODUCT_REACTIVATED`) y emite el evento de revalidación (`tariff_annex.create`, `Idempotency-Key`).
- `PATCH /admin/tariff-annex/products/:id` — activar/desactivar (`tariff_annex.update`).
- `DELETE /admin/tariff-annex/products/:id` — desactivación lógica, sin destruir historial (`tariff_annex.delete`).
- `POST /admin/tariff-annex/imports` — cargue masivo CSV/XLSX, 20 MB, 202 (`tariff_annex.import`, `Idempotency-Key`).
- `GET /admin/tariff-annex/imports`, `GET /admin/tariff-annex/imports/:id` y `GET /admin/tariff-annex/imports/:id/rows` — progreso y resultado por fila (`tariff_annex.read`).
- `GET /admin/tariff-annex/eps-novedades?format=csv|xlsx` — base de novedades EPS on-demand (solo MTD, `operational_exports.create`).

Todos los endpoints exigen organización MTD validada en backend. El encabezado `Idempotency-Key` es obligatorio en mutaciones.

## Cargue masivo

Contrato de encabezados exactos del archivo comercial:

`Codigo Medicamento`, `Tarifa de la unidad`, `Número de Expediente del INVIMA`, `Consecutivo INVIMA (Presentación)`, `Descripción Genérica del Medicamento (DCI)`, `Descripción Comercial del Medicamento`, `Laboratorio del Medicamento`, `Tipo de Inclusion del Medicamento (PBS/NOPBS)`.

`Codigo Medicamento` se mapea a `codigo_producto`, que pertenece al mismo dominio de `codigo_medicamento`.

Resultados por fila (códigos estables):

| Código                 | Uso                                            |
| ---------------------- | ---------------------------------------------- |
| `PRODUCT_CREATED`      | Producto agregado al Anexo Tarifario.          |
| `PRODUCT_REACTIVATED`  | Producto inactivo reactivado.                  |
| `PRODUCT_EXISTING`     | Ya se encontraba registrado y activo.          |
| `INVALID_PRODUCT_CODE` | Código obligatorio vacío o formato inválido.   |
| `DUPLICATE_IN_FILE`    | Código repetido dentro del archivo.            |
| `INVALID_FILE_FORMAT`  | Estructura de archivo inválida / archivo vacío.|
| `PROCESSING_ERROR`     | Error técnico estable de procesamiento.        |

- Una fila inválida no impide procesar las demás.
- Idempotente: cargar dos veces el mismo archivo no duplica productos (unicidad total + llave lógica organización+sha256).
- Archivo vacío o sin encabezado `codigo_producto` falla el lote (`EMPTY_FILE`/`INVALID_FILE_FORMAT` en `last_error_code`).

## Auditoría

Eventos inmutables en `audit_events` (actor, organización, antes/después, correlation ID, timestamp):

- `TARIFF_PRODUCT_CREATED`, `TARIFF_PRODUCT_ACTIVATED`, `TARIFF_PRODUCT_DEACTIVATED`.
- `TARIFF_ANNEX_IMPORT_CREATED`, `TARIFF_ANNEX_IMPORT_COMPLETED`.
- `TARIFF_ANNEX_VALIDATION_PASSED` / `TARIFF_ANNEX_VALIDATION_FAILED` (por ítem evaluado).
- `TARIFF_ANNEX_REVALIDATION_STARTED` (por ítem revalidado).
- `EPS_NOVEDADES_EXPORT_CREATED` (actor, formato, cantidad de registros, columnas).

## Regla de dominio

```text
VALIDACION_ESTADO_AUTORIZACION
AND VALIDACION_CLASIFICACION_PBS_NO_PBS
AND VALIDACION_VIGENCIA_AUTORIZACION
AND VALIDACION_ANEXO_TARIFARIO (producto activo en el Anexo)
AND VALIDACIONES_MIPRES_SI_NO_PBS
AND DEMAS_VALIDACIONES_EXISTENTES
    => READY_TO_DISPENSE
```

En la confirmación del cargue, cada fila evalúa la membresía del Anexo. Un producto ausente produce `tariff_membership_status = NOT_LISTED` y `operation_status = BLOCKED`; el ítem **se conserva** (no se elimina ni se pierde) y queda disponible para revalidación. Las filas con producto listado continúan las demás reglas y alcanzan `READY_TO_DISPENSE` cuando todas se cumplen.

La función central `deriveOperationStatus()` exige `productInTariffAnnex`; se aplica en la confirmación, el reprocesamiento MIPRES y la actualización explícita. PBS no consulta MIPRES; NO PBS continúa exigiendo direccionamiento vigente.

## Causal y novedades EPS

- Causal estable: `PRODUCT_NOT_IN_TARIFF_ANNEX` — "Producto no incluido en el Anexo Tarifario".
- Las causales se derivan por registro (`deriveEpsNovedadCausales`): `SOURCE_STATUS_BLOCKED`, `AUTHORIZATION_EXPIRED`, `DIRECTION_PENDING`, `DIRECTION_QUERY_ERROR`, `PRODUCT_NOT_IN_TARIFF_ANNEX`. Un registro puede acumular varias.
- La base de novedades EPS contiene únicamente registros que no alcanzaron `READY_TO_DISPENSE` y conserva todas las causales activas. Columnas mínimas: `authorization_key`, `numero_autorizacion`, `codigo_medicamento`, `coverage_type`, `causal`, `detalle_novedad`, más los campos operativos de identificación. On-demand, sin copia persistente (ADR-018), auditada.

## Revalidación automática

```text
PostgreSQL (outbox tariff.product.activated, idempotencia por versión de producto)
    ↓
Dispatcher → BullMQ (cola tariff-annex)
    ↓
Worker (TariffRevalidationProcessor)
    ↓
Autorizaciones con codigo_medicamento = codigo_producto AND tariff_membership_status = 'NOT_LISTED'
    ↓
resolver causal → re-ejecutar deriveOperationStatus → transición normal
```

- Selección dirigida e indexada (`authorization_items_tariff_membership_idx`); nunca se revalidan todas las autorizaciones.
- Si el Anexo era la única novedad → `READY_TO_DISPENSE`, evento `AUTHORIZATION_READY_TO_DISPENSE` y notificaciones OLP/Medicarte por el mismo pipeline, idempotencia (`ready:{item}:{readinessVersion}:{destinatario}`) y reintentos existentes. No hay ruta especial.
- Si existen otras novedades → solo se resuelve la causal del Anexo; el registro permanece bloqueado por las causales restantes.
- NO PBS: agregar el producto no omite MIPRES; el direccionamiento continúa gestionado por su flujo vigente.
- Idempotencia: reintentos del job, ejecuciones duplicadas y varias autorizaciones con el mismo código no duplican efectos (`job_results`, chequeo por ítem bajo lock, outbox `on conflict do nothing`).
- Ítems en `DISPENSATION_REPORTED` o `DISPENSED` nunca son modificados ni retroceden.

## Desactivación de un producto

- Baja lógica (`active = false`), versión incrementada, auditoría `TARIFF_PRODUCT_DEACTIVATED`.
- No modifica retroactivamente registros ya listos, reportados o dispensados; no destruye resultados históricos ni evidencia.
- La evaluación de nuevos ítems y las revalidaciones posteriores aplican el catálogo vigente al momento de evaluar.

## UI

Vista `Anexo Tarifario` (solo MTD): listado, búsqueda, estado activo/inactivo, fechas, crear, activar/desactivar, cargue masivo CSV/XLSX, resultado por fila del cargue, plantilla descargable y descarga de novedades EPS (CSV/XLSX). La UI oculta acciones según permisos, pero toda autorización se valida en backend.

## Aceptación

- MTD con permiso accede; Compensar, OLP y Medicarte reciben denegación en backend.
- Producto fuera del Anexo impide `READY_TO_DISPENSE` desde cualquier ruta de escritura (invariante en PostgreSQL) y conserva el ítem bloqueado con causal estable.
- Crear o activar un producto después revalida automáticamente las autorizaciones afectadas sin recargar el archivo.
- Un registro puede mostrar múltiples causales y las conserva mientras permanezcan activas.
- Ninguna validación crítica vive únicamente en frontend; toda mutación y exportación queda auditada.
