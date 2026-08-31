# SPEC-014 — Anexo Tarifario

**Fase:** transversal (posterior a F6). ADR-024, ADR-003, ADR-009, ADR-014, ADR-016, ADR-018, ADR-007.

## Objetivo

Catálogo administrativo de MTD que define los códigos de producto válidos para que una autorización alcance `LISTO_PARA_DISPENSAR`. El código contra el que se valida es `authorization_items.codigo_medicamento` (misma normalización técnica de `COD_COMERCIAL`). No se usan CUM, CUPS, descripción, nombre o principio activo.

## Modelo de datos

- `tariff_annex_products`: `codigo_producto` (único, normalizado), `active` (baja lógica), `organization_id`, `created_by`/`updated_by`, `version`, timestamps. La unicidad es total para permitir reactivar sin duplicar.
- `tariff_annex_imports` / `tariff_annex_import_source_files` / `tariff_annex_import_rows`: staging del cargue masivo (mismo patrón de ADR-013/SPEC-001; fuente temporal `BYTEA`, se nulifica al finalizar).
- `authorization_items` agrega `tariff_membership_status` (`NO_EVALUADO|LISTADO|NO_LISTADO`), `tariff_membership_evaluated_at`, `tariff_rule_version` (`TARIFF-ANNEX-1`). El invariante de base extiende el prerrequisito de `LISTO_PARA_DISPENSAR` con `tariff_membership_status = 'LISTADO'`.
- Backfill de migración: los ítems preexistentes quedan `LISTADO` (evaluados antes de que existiera el Anexo; sin efecto retroactivo).

## API

- `GET /admin/tariff-annex/products` — listado con búsqueda por código y filtro `active` (`tariff_annex.read`).
- `POST /admin/tariff-annex/products` — crear; idempotente: activo existente devuelve `PRODUCT_EXISTING`; inactivo existente se reactiva (`PRODUCT_REACTIVATED`) y emite el evento de revalidación (`tariff_annex.create`, `Idempotency-Key`).
- `PATCH /admin/tariff-annex/products/:id` — activar/desactivar (`tariff_annex.update`).
- `DELETE /admin/tariff-annex/products/:id` — desactivación lógica, sin destruir historial (`tariff_annex.delete`).
- `POST /admin/tariff-annex/imports` — cargue masivo CSV/XLSX, 20 MB, 202 (`tariff_annex.import`, `Idempotency-Key`).
- `GET /admin/tariff-annex/imports/:id` y `GET /admin/tariff-annex/imports/:id/rows` — progreso y resultado por fila (`tariff_annex.read`).
- `GET /exports/eps-novedades.csv|.xlsx` — base de novedades EPS on-demand (solo MTD, `operational_exports.create`).

Todos los endpoints exigen organización MTD en backend. El encabezado `Idempotency-Key` es obligatorio en mutaciones.

## Cargue masivo

Contrato de encabezados exactos: `codigo_producto` (mínimo y único campo obligatorio; mismo dominio de `codigo_medicamento`).

Resultados por fila (códigos estables):

| Código                | Uso                                            |
| --------------------- | ---------------------------------------------- |
| `PRODUCT_CREATED`     | Producto agregado al Anexo Tarifario.          |
| `PRODUCT_REACTIVATED` | Producto inactivo reactivado.                  |
| `PRODUCT_EXISTING`    | Ya se encontraba registrado y activo.          |
| `INVALID_PRODUCT_CODE`| Código obligatorio o formato inválido.         |
| `DUPLICATE_IN_FILE`   | Código repetido dentro del archivo.            |
| `INVALID_FILE_FORMAT` | Estructura de archivo inválida / archivo vacío.|
| `PROCESSING_ERROR`    | Error técnico estable de procesamiento.        |

- Una fila inválida no impide procesar las demás.
- Idempotente: cargar dos veces el mismo archivo no duplica productos (unicidad total + lote terminal `COMPLETADO`/`FALLIDO`).
- Archivo vacío o sin filas de datos falla el lote (`EMPTY_FILE`/`INVALID_FILE_FORMAT` en `last_error_code`).

## Auditoría

Eventos inmutables en `audit_events` (actor, organización, antes/después, correlation ID, timestamp):

- `TARIFF_PRODUCT_CREATED`, `TARIFF_PRODUCT_UPDATED`, `TARIFF_PRODUCT_DEACTIVATED`, `TARIFF_PRODUCT_EXISTING`.
- `TARIFF_ANNEX_IMPORT_CREATED`, `TARIFF_ANNEX_IMPORTED`.
- `TARIFF_ANNEX_VALIDATION_PASSED` / `TARIFF_ANNEX_VALIDATION_FAILED` (por ítem evaluado).
- `TARIFF_ANNEX_REVALIDATION_STARTED`, `AUTHORIZATION_BECAME_READY_TO_DISPENSE` (por ítem revalidado).
- `EPS_NOVEDADES_EXPORT_CREATED` (actor, formato, filtros, cantidad de registros, resultado).

## Regla de dominio

```text
VALIDACION_ESTADO_AUTORIZACION
AND VALIDACION_CLASIFICACION_PBS_NO_PBS
AND VALIDACION_VIGENCIA_AUTORIZACION
AND VALIDACION_ANEXO_TARIFARIO (tariff_membership_status = LISTADO)
AND VALIDACIONES_MIPRES_SI_NO_PBS
AND DEMAS_VALIDACIONES_EXISTENTES
    => LISTO_PARA_DISPENSAR
```

La función central `deriveOperationStatus()` exige `tariffListed`; se aplica en confirmación de importación, procesamiento MIPRES y actualización explícita. PBS no consulta MIPRES; NO PBS continúa exigiendo direccionamiento vigente.

## Causal y novedades EPS

- Causal estable: `PRODUCT_NOT_IN_TARIFF_ANNEX` — "Producto no incluido en el Anexo Tarifario".
- Usable en bandejas (filtro `tariffMembershipStatus`), reportes, exportaciones, auditoría e indicadores.
- La base de novedades EPS contiene únicamente registros sin `LISTO_PARA_DISPENSAR` y conserva todas las causales activas por registro (ej. `AUTHORIZATION_EXPIRED;PRODUCT_NOT_IN_TARIFF_ANNEX`). Columnas mínimas: `authorization_key`, `numero_autorizacion`, `codigo_medicamento`, `coverage_type`, `resultado_validacion`, `causal`, `detalle_novedad`, más la evidencia relevante de origen. On-demand, sin copia persistente (ADR-018).

## Revalidación automática

```text
PostgreSQL (outbox tariff.product.activated, idempotencia por versión de producto)
    ↓
Dispatcher → BullMQ (cola tariff-annex)
    ↓
Worker (TariffRevalidationProcessor)
    ↓
Autorizaciones con codigo_medicamento = codigo_producto AND tariff_membership_status = 'NO_LISTADO'
    ↓
resolver causal → re-ejecutar deriveOperationStatus → transición normal
```

- Selección dirigida e indexada (`authorization_items_tariff_membership_idx`); nunca se revalidan todas las autorizaciones.
- Si el Anexo era la única novedad → `LISTO_PARA_DISPENSAR`, evento `AUTHORIZATION_READY_TO_DISPENSE` y notificaciones OLP/Medicarte con el mismo pipeline, idempotencia (`ready:{item}:{readinessVersion}:{destinatario}`), destinatarios y reintentos existentes.
- Si existen otras novedades → solo se resuelve la causal del Anexo; el registro permanece en la base de novedades EPS con las causales restantes.
- NO PBS: agregar el producto no omite MIPRES; el direccionamiento continúa gestionado por su flujo vigente.
- Idempotencia: reintentos del job, ejecuciones duplicadas y varias autorizaciones con el mismo código no duplican efectos (`job_results`, chequeo por ítem bajo lock, outbox `on conflict do nothing`).
- Ítems en `DISPENSACION_REPORTADA` o `DISPENSADO` nunca son modificados ni retroceden.

## Desactivación de un producto

- Baja lógica (`active = false`), versión incrementada, auditoría `TARIFF_PRODUCT_DEACTIVATED`.
- No modifica retroactivamente registros ya listos, reportados o dispensados; no destruye resultados históricos ni evidencia.
- La evaluación de nuevos ítems y las revalidaciones posteriores aplican el catálogo vigente al momento de evaluar.

## UI

Vista `Anexo Tarifario` (solo MTD): listado, búsqueda, estado activo/inactivo, fechas, crear, editar/reactivar, desactivar, cargue masivo, resultado del último cargue, plantilla descargable y descarga de novedades EPS. La UI oculta acciones según permisos, pero toda autorización se valida en backend.

## Aceptación

- MTD con permiso accede; Compensar, OLP y Medicarte reciben denegación en backend.
- Producto fuera del Anexo impide `LISTO_PARA_DISPENSAR` desde cualquier ruta de escritura (invariante en PostgreSQL).
- Agregar un producto previamente inexistente revalida automáticamente las autorizaciones afectadas sin recargar la base.
- Un registro puede mostrar múltiples causales y las conserva mientras permanezcan activas.
- Ninguna validación crítica vive únicamente en frontend; toda mutación y exportación queda auditada.
