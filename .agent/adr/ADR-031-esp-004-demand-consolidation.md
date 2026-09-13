# ADR-031 — Consolidación de demanda proyectada (ESP-004)

## Estado

Aceptada.

## Contexto

ESP-003 dejó la programación de Medicarte como fuente clínica trazable. ESP-004
convierte las programaciones vigentes en demanda logística consolidada por
período + punto + código comercial, sin compras, entregas, inventario ni
aplicaciones. La demanda consolidada no es editable manualmente.

## Decisiones

### Identidad de consolidación y línea única

```text
planning_period_id + dispensing_point_id + commercial_code
```

- Una sola fila `projected_demand_lines` por identidad (
  `projected_demand_lines_identity_unique`, UNIQUE CONSTRAINT que en 0035
  renombra la restricción creada en ESP-001 para poder referenciarla con FK
  compuesto).
- `projected_quantity = regular_quantity + late_quantity` (
  `projected_demand_lines_split_check`) y `projected_quantity > 0`.

### Preiodo efectivo resuelto en el dominio

`resolveEffectiveSchedulePeriod` es la única regla que decide a qué período
aporta una programación y con qué clasificación:

- `ON_TIME` → período propio, `REGULAR`;
- `LATE + COMPLEMENTARY_PURCHASE_ORDER` → período propio, `LATE` (ESP-005
  materializa la OC sobre ese período);
- `LATE + NEXT_PERIOD` → período diferido y **bucket REGULAR**. Los hechos
  históricos permanecen en `demand_sources` como snapshot:
  `schedule_timing = LATE`, `late_handling = NEXT_PERIOD`,
  `demand_bucket = REGULAR`; el lineage original/effective se conserva
  (ds.planning_period_id = período efectivo, join con el schedule para el
  período de origen);
- `LATE + NEXT_PERIOD` sin período diferido es una inconsistencia imposible
  (ESP-003 nunca la persiste) y ABORTA de forma explícita
  (`DemandConsolidationError`, código `PROJECTED_DEMAND_INCONSISTENT_SCHEDULE`):
  no hay deduplicación ni reparación silenciosa.

### Fuentes

Solo `patient_schedules` vigentes (`SCHEDULED`/`RESCHEDULED`);
`CANCELLED` no participa y `patient_schedule_history` jamás se suma
directamente. SIN `DISTINCT` ni deduplicación heurística: la identidad activa
de programación (migración 0034) ya garantiza una fila activa por
(auth item, punto, fecha). Nota: dos programaciones del mismo item/punto en
fechas distintas del mismo período son eventos distintos que aportan cada una
a la misma línea, como fuentes separadas con su propio snapshot.

### Lineage y snapshots

`demand_sources` referencia `(patient_schedule_id, schedule_revision)` — FK a
`patient_schedule_history` — y ahora registra `planning_period_id`,
`dispensing_point_id`, `commercial_code` (pertenencia de la fuente a la
identidad de la línea, impuesta por FK compuesto) y `schedule_timing`
(snapshot). Cortar en dos toques es imposible: la cantidad almacenada es la
del snapshot del history de la revisión referenciada, y la verificación
transaccional exige `ds.quantity = hsh.quantity`. Trazas reconstruibles:
línea → sources → schedule → authorization item.

### Consolidación idempotente (reconciliación completa)

`consolidatePeriod(periodId)` en una sola transacción:

1. `FOR UPDATE` del `planning_period`: dos consolidaciones simultáneas del
   mismo período serializan; períodos distintos corren paralelos sin
   compartir el lock (los schedules NO se bloquean: la consolidación jamás
   los modifica y su mutación solo invita a la próx consolidación).
2. Lectura consistente de schedules vigentes; resolución del período
   efectivo porSchedule; agrupación por identidad — sin DISTINCT.
3. Reconciliación de líneas: las líneas no deseadas se borran junto con sus
   fuentes (una Cancelación completa elimina la línea si era única Wendy
   fuente); las líneas deseadas se crean/actualizan solo cuando el estado
   cambia (guarda por fingerprint de fuentes y cantidades). Idempotencia:
   consolidar dos veces sin cambios no escribe nada, no acumula y no duplica.
4. Verificación transaccional de invariantes agregadas (suma de fuentes por
   `demand_bucket` == projected == regular + late; snapshot contra history)
   y `audit_event` `PROJECTED_DEMAND_CONSOLIDATED` con resumen (líneas,
   fuentes, regular, late, total, actor). Sin triggers de sumas: los checks
   de PostgreSQL (split) más la verificación agregada en la transacción
   cumplen la misma fuerza sin costo de escritura.

Versionado semántico de línea: `projected_demand_lines.revision` avanza ante
CUALQUIER cambio material: cantidad regular/late/proyectada o la composición
de fuentes (fingerprint (schedule|revision|quantity|timing)). Mismo estado
lógico ⇒ sin escritura y misma revisión (idempotencia).

### RBAC

`projected_demand.read`: MTD_ADMIN, MTD_OPERATOR, MTD_GENERAL, MTD_AUDITORIA,
READ_ONLY. `projected_demand.manage` (consolidar): MTD_ADMIN y MTD_OPERATOR.
MEDICARTE/OLP/COMPENSAR no acceden inicialmente; la regla se reexamina con
requerimiento explícito.

### API

- `POST /planning-periods/:id/consolidate` → `projected_demand.manage`.
- `GET /projected-demand?planningPeriodId=...(&dispensingPointId|commercialCode)`
- `GET /projected-demand/:id`, `GET /projected-demand/:id/sources`.

### Sin efectos laterales

La consolidación no toca `authorization_items` ni `patient_schedules` (solo
lecturas), no crea OC/inventario (no existen estas tablas todavía). El unique
de línea evita duplicados aún con dos consolidation concurrentes.

## Consecuencias

Positivas:
- Estado derivado reproducible: correr la consolidación en cualquier
  momento/veces reconstruye siempre el mismo resultado y mantiene lineage.
- Las sumas por timing (`regular`/`late`) facilitan ESP-005 (OC regular
  versus complementarias) y ESP-011 sin recomputar fuentes.

Costos y límites:

- La reconciliación borra líneas vacías del período consolidado; si la
  operación requiere conservar líneas también sin fuentes (trazas históricas
  para compra cero), se ajustará en una especificación posterior.
- Re-consolidar el período de ORIGEN tras un NEXT_PERIOD es manual (los
  schedules quedan apuntando al diferido); es la estrategia documentada y
  auditable, sin dedupe silencioso.
