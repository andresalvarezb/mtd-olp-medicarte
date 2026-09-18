# RESULTADOS DEVELOP - MACRO PASO 1

## Rama y base

- Rama: feat/convergence-w1-tariff-foundation
- Base arquitectonica: develop
- Baseline inicial: 918a28b01494e9d17139fa69addff9e01106a667
- master se uso solo como referencia semantica.

## Alcance

Macro Paso 1: Anexo Tarifario + trazabilidad + UPLOAD -> PREPARE -> PREVIEW -> CONFIRM -> APPLY.

## 1A Foundation

Migraciones 0056, 0057 y 0058.
Resultados: logical key determinista, no duplicados activos, historico preservado, provenance, revisiones inmutables y snapshots.
Gate W1: PASS.

## 1B PREPARE / CONFIRM

Migraciones 0059 y 0060.
Estados: UPLOADED, VALIDATING, PREPARED, CONFIRMING, COMPLETED, FAILED, CANCELLED.
Preview: PREVIEW_NEW, PREVIEW_UNCHANGED, PREVIEW_CHANGED, PREVIEW_ANOMALOUS, PREVIEW_REJECTED.

## 1C Runtime

Parser XLSX con aliases maduros y legacy para codigo, tarifa, INVIMA, descripcion generica, descripcion comercial, laboratorio y tipo de inclusion.
PREPARE genera y persiste preview sin modificar el catalogo activo.
CONFIRM crea producto/revision para NEW, nueva revision para CHANGED y NO_OP real para UNCHANGED.
CONFIRM repetido es idempotente.
Anomalias cercanas a x1000 o /1000 requieren override explicito.

Endpoints:

- POST /admin/tariff-annex/imports
- POST /admin/tariff-annex/imports/:importId/prepare
- GET /admin/tariff-annex/imports/:importId
- POST /admin/tariff-annex/imports/:importId/confirm

Controles: AuthGuard, aislamiento organizacional, MTD, permisos import/read, XLSX maximo 20 MB, SHA256 y deduplicacion por organizacion + hash.

## Defectos encontrados y corregidos

1. Serializacion de timestamps raw SQL: se agrego conversion defensiva para Date/string/number/null.
2. Aliases \*\_MEDICAMENTO: preparedSnapshot ahora conserva descripcion generica, descripcion comercial y laboratorio durante PREPARE -> CONFIRM.

## 1D Migraciones

El timestamp 1790550440663 corresponde a 0053_esp020_custom_roles. La instalacion desde cero confirmo que 0054-0060 no se omiten.

Se reprodujo compatibilidad historica 0058 -> 0059 con una fila COMPLETED anterior a confirmed_at/confirmed_by.
La restriccion inicial fallaba. Se corrigio para exigir metadata de confirmacion solo durante CONFIRMING, sin backfill ficticio.
El runtime mantiene PREPARED -> CONFIRMING -> COMPLETED.

Certificacion:

- base vacia hasta 0060: PASS
- upgrade historico: PASS
- fila COMPLETED historica preservada: PASS
- CONFIRMING sin actor/fecha rechazado: PASS

## Gate HTTP

Se certifico bloqueo OLP, carga MTD, PREPARE sin mutacion, CONFIRM, metadata comercial, tarifa canonical e idempotencia.
HTTP_GATE_RC=0.

## Regresion final

- lint: PASS
- typecheck: PASS
- unit: PASS
- build: PASS
- gates Macro Paso 1: PASS
- Gate F1 con worker activo: PASS
- integration completa: PASS
- migraciones Step 1: PASS
- Prettier incremental: PASS
- git diff --check: PASS

Resultado final:
WORKER_BUILD_RC=0
WORKER_RUN_RC=0
WORKER_READY_RC=0
F1_RC=0
INTEGRATION_RC=0
FORMAT_INCREMENTAL_RC=0
MIGRATION_STATE_RC=0
DIFF_RC=0

## Prettier

El check global reporta deuda historica de formato fuera del alcance. No se reformatearon archivos ajenos. El gate incremental del Macro Paso 1 paso.

## Semantica final

- NEW = producto + revision 1
- UNCHANGED = NO_OP
- CHANGED = nueva revision
- historial preservado
- PREPARE no modifica catalogo
- CONFIRM idempotente
- anomalías requieren override
- revisiones append-only
- provenance preservado
- aislamiento por organizacion preservado

## Decisiones

1. develop continua como base arquitectonica.
2. master solo fue referencia semantica.
3. No se introdujeron microservicios adicionales.
4. No se modifico el modelo general Outbox/BullMQ.
5. No hubo backfills historicos ficticios.
6. No se debilitaron tests.
7. No se reformateo deuda historica fuera del alcance.

## Proximo paso

Macro Paso 2: producto activo en AT, tipo_inclusion PBS, rechazo NO_PBS, vigencia, recarga inteligente y bloqueo de actualizacion cuando exista compromiso efectivo por orden de compra.

No iniciar Macro Paso 2 antes del cierre de la PR de Macro Paso 1.
