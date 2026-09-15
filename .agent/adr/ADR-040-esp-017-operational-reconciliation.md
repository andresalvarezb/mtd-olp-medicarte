# ADR-040 — ESP-017 Reconciliación operacional e integridad end-to-end

Estado: implemented / pending review  
Fecha: 2026-09-15

## Contexto

ESP-001…ESP-016 construyeron el dominio operacional moderno sobre PostgreSQL. Las invariantes viven en constraints, triggers y servicios. ESP-017 añade un subsistema de **verificación** ejecutable sobre una base real. No es una nueva fuente de verdad y no repara datos.

La pregunta del motor es: ¿la base actual es internamente coherente con las invariantes del dominio? No: ¿qué estado debería inventar para que parezca coherente?

## Decisión

### Reconciliation != source of truth

PostgreSQL sigue siendo la única fuente de verdad operacional. `reconciliation_runs` y `reconciliation_findings` registran evidencia de un scan. Un finding no autoriza mutar `patient_schedules`, `inventory_movements`, `purchase_orders` ni ninguna otra tabla operacional.

No hay auto-repair. No hay botón "REPARAR AUTOMÁTICAMENTE". `recommendedAction` es investigación, no una receta destructiva.

### Rule registry

La identidad de cada detector es un `ruleCode` estable (`REC-INV-001`, `REC-APP-003`, …). El registry único vive en `packages/domain/src/reconciliation-registry.ts` (`RECONCILIATION_RULES`, versión `ESP-017.1`). ADR, API, CLI, UI y catálogo usan el mismo registry. No se reescriben findings históricos cuando una regla evoluciona: cada finding persiste `ruleVersion` y el run persiste `rulesVersion`.

Ownership: una violación raíz produce un solo finding. `REC-OUT-002` es owned-by `REC-APP-006`. `REC-LEG-003` es owned-by `REC-AUD-002`.

### Categoría y severidad

| Categoría      | Semántica                                              |
| -------------- | ------------------------------------------------------ |
| INTEGRITY      | estado imposible / violación fuerte                    |
| CONSISTENCY    | dos hechos que deberían coincidir divergen             |
| RECONCILIATION | proyección/materialización vs sus fuentes              |
| OBSERVATION    | relevante operativamente, no necesariamente incorrecta |

Severidades: CRITICAL, ERROR, WARNING, INFO. INFO no hace fallar el CLI. CRITICAL/ERROR sí (`exit 1`). Falla técnica del motor: `exit 2` y run `FAILED`.

`FAILED` significa que el motor no pudo terminar. Un run `COMPLETED` puede contener findings.

### Applicability

Cada regla retorna `PASS`, `FAIL` o `NOT_APPLICABLE`. Cero filas relevantes no es PASS artificial. Ejemplo: `REC-TRF-005` sin transfers `RECEIVED` → `NOT_APPLICABLE`. Una excepción técnica → `ERROR_EXECUTING_RULE`; si la regla es CRITICAL, el run termina `FAILED`. No se afirma integridad si el detector no corrió.

### Snapshot isolation

El scan abre `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` y `SET LOCAL statement_timeout`. Todas las reglas leen el mismo snapshot. El commit es `ROLLBACK`. Las escrituras de runs/findings usan otra conexión, fuera de esa transacción. No se bloquea la operación normal con locks de escritura.

### Run-level snapshot semantics

Un `reconciliation_run` observa **un único snapshot lógico** de PostgreSQL. Varias transacciones `REPEATABLE READ` independientes no equivalen a ese snapshot.

Writer connection (`pool.query`, fuera del reader):

1. crea `reconciliation_runs` en `PENDING` y lo marca `RUNNING`;
2. persiste `reconciliation_findings` derivados del snapshot **mientras el reader sigue abierto**;
3. tras el `ROLLBACK` del reader, finaliza el run `COMPLETED` o `FAILED` con contadores.

Reader connection (`pool.connect()`, un `PoolClient`):

```
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
SET LOCAL statement_timeout = 30000
SELECT pg_current_snapshot()   -- fija el snapshot; no el BEGIN
-- org/tenant lookup
-- RULE_1 … RULE_N con el mismo client/tx
ROLLBACK
```

Todas las reglas operacionales ejecutan `rule.evaluate(context)` con el **mismo** `context.snapshot` y el mismo `context.query` ligado a ese client. El query queda cerrado (`SNAPSHOT_CLOSED`) al liberar el reader. Una rule no puede abrir el pool global ni otro snapshot operacional.

Un `COMMIT` operacional concurrente **después** de fijar el snapshot pertenece al **siguiente** run. No aparece a mitad del run actual.

Las tablas ESP-017 se escriben fuera de la transacción `READ ONLY`. Esas escrituras no invalidan el snapshot operacional. Las rules no leen `reconciliation_findings` como fuente de dominio.

Falla técnica (statement timeout 30s, error SQL, pérdida del reader, transacción abortada): el run queda `FAILED`. No se concluye `COMPLETED` + `PASS` sobre un snapshot incompleto.

El lookup de `organizations` y los filtros de tenant viven en ese mismo context: MTD ve el dominio operacional; otro tenant no hereda un client sin filtro.

### Read-only operacional

Las reglas solo leen dominios ESP-001…016. Únicas tablas escribibles: `reconciliation_runs`, `reconciliation_findings`. El gate comprueba checksum de hechos antes/después y que el engine no contiene `update patient_schedules`.

### Stale vs corruption

| Condición                             | Clasificación         |
| ------------------------------------- | --------------------- |
| Projected demand no reconsolidada     | WARNING / OBSERVATION |
| Receipt accepted sin movement RECEIPT | CRITICAL / INTEGRITY  |
| Bulk PROCESSING con lease vencido     | WARNING / RECOVERABLE |
| Transfer DISPATCHED sin TRANSFER_IN   | NORMAL (REC-TRF-006)  |
| Over-order tras baja de demanda       | no es finding         |

### Historical applicability

La generación se decide por evidencia estructural (existencia de `patient_schedules`, `patient_applications`, movements, etc.), no por una fecha arbitraria. Un registro historical-only sin lineage moderno es NORMAL (`REC-LEG-004`): se evalúa y no genera finding. Las reglas modernas aplican cuando hay evidencia de flujo moderno.

### Tenant isolation

`tenant_id` del run es `organizations.id`. Un run de tenant A no lista ni cuenta findings de B. El dominio operacional no tiene `tenant_id` en cada tabla: MTD ve el dominio operacional; otras orgs solo ven bulk de su `organization_id`. Medicarte point scope no autoriza el reconciler. `dispensingPointId` es filtro de consulta, no RBAC.

### Max findings / performance

`MAX_FINDINGS_PER_RULE = 1000`. Se persisten los primeros N y `truncated = true` si `totalDetected` es mayor. `statement_timeout` 30s. Queries set-based (JOIN/GROUP BY/HAVING/CTE/NOT EXISTS). No hay scheduler automático: ejecución manual API/UI/CLI.

### PREVENTED_BY_DB vs DETECTABLE_BY_RECONCILIATION

El reconciler complementa constraints. No se deshabilitan constraints productivos para fabricar findings. Identidad activa duplicada de schedules y grants activos duplicados se testean como PREVENTED_BY_DB. Movements faltantes, READY sin APPROVED (vía trigger disable solo en test) y entity_reference inválida son DETECTABLE_BY_RECONCILIATION.

### PHI-safe evidence

Evidence JSON usa IDs técnicos. Se descartan claves de nombre, documento, historia, payload y `source_data`. No se copian filas completas. La UI MTD resuelve datos nominativos por módulos normales y RBAC.

### Fingerprint

`ruleCode|entityType|entityId|relatedEntityId` identifica la misma inconsistencia entre runs. Unique por `(run_id, rule_code, fingerprint)` evita duplicados dentro de un run. No es PK global ni lifecycle firstSeen/lastSeen.

### Inventory / transfer / application / outcome

No hay ecuación global `received - applied = current inventory`. Conservación por lineage:

- receipt accepted → exactamente un RECEIPT movement;
- transfer RECEIVED → OUT + IN equivalentes; DISPATCHED sin IN es válido;
- application CONFIRMED → APPLICATION movement;
- NON_REUSABLE → NON_REUSABLE movement.

`physicalBalance(lot) = SUM(inventory_movements.quantity_delta)`. El ledger es source of truth: no hay segunda columna mutable que comparar. `usableBalance = 0` por vencimiento no es balance negativo.

### API / RBAC / CLI / UI

MTD-only. Permisos `reconciliation.read` y `reconciliation.run`. `READ_ONLY` lee, no ejecuta. Medicarte, OLP y Compensar denegados. CLI `pnpm reconciliation:run`. UI "Integridad operacional". No hay resolución de findings.

### Índices

Índices nuevos solo en tablas ESP-017 (`tenant_id, started_at`, severity/rule/domain por run). No se añadieron índices masivos en tablas operacionales: las reglas reutilizan unique/FK existentes (`patient_schedules_active_identity_idx`, `user_point_scopes_active_uniq`, PKs de movements por `source_id`).

### Release gate

Gate A: 50 migraciones (0000–0049). Gate B: únicamente `0049_esp017_operational_reconciliation.sql` sobre ESP-016. Baseline: slice válido → 0 CRITICAL/ERROR. Injection: corrupción controlada produce el `ruleCode` esperado.

## Consecuencias

- Migración `0049_esp017_operational_reconciliation.sql`.
- Registry `ESP-017.1`.
- Motor `apps/api/src/reconciliation/`.
- Sin auto-repair, sin scheduler, sin DROP legacy.
- PostgreSQL permanece source of truth.
