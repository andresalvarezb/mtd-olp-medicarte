# ADR-031 — Consolidación de demanda proyectada (ESP-004)

## Estado

Aceptada.

## Contexto

El cargue de autorizaciones es la fuente clínica y operativa de la demanda.
ESP-004 convierte las autorizaciones cargadas en demanda logística consolidada
por período + punto + código comercial, sin compras, entregas, inventario ni
aplicaciones. La programación de Medicarte ya no participa en este cálculo y la
demanda consolidada no es editable manualmente.

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

### Ubicación de la autorización en el período

La fecha `FECHA_PROGRAMADA` del cargue ubica la autorización en el período y el
campo `PUNTO` identifica el punto de dispensación. Toda autorización cargada
aporta al bucket `REGULAR`; no existen buckets derivados de agendamiento.

Si no existe fecha o punto válido, la autorización no puede generar demanda
proyectada y queda fuera del consolidado para revisión del cargue.

### Fuentes

Solo `authorization_items` habilitadas provenientes del cargue; la cantidad se
lee de `CANTIDAD`. La identidad de la autorización evita duplicados y cada
autorización es una fuente separada de la línea consolidada.

### Lineage y snapshots

`demand_sources` referencia la autorización cargada y conserva el `loaded_at`
del cargue. Las columnas de programación se mantienen solo para lineage
histórico. Trazas nuevas: línea → sources → authorization item → import batch.

### Consolidación idempotente (reconciliación completa)

`consolidatePeriod(periodId)` en una sola transacción:

1. `FOR UPDATE` del `planning_period`: dos consolidaciones simultáneas del
   mismo período serializan; períodos distintos corren paralelos sin
   compartir el lock (los schedules NO se bloquean: la consolidación jamás
   los modifica y su mutación solo invita a la próx consolidación).
2. Lectura consistente de autorizaciones habilitadas; ubicación por fecha y
   punto; agrupación por identidad — sin DISTINCT.
3. Reconciliación de líneas: las líneas no deseadas se borran junto con sus
   fuentes (una Cancelación completa elimina la línea si era única Wendy
   fuente); las líneas deseadas se crean/actualizan solo cuando el estado
   cambia (guarda por fingerprint de fuentes y cantidades). Idempotencia:
   consolidar dos veces sin cambios no escribe nada, no acumula y no duplica.
4. Verificación transaccional de invariantes agregadas (suma de fuentes por
   `demand_bucket` == projected == regular + late; autorización existente)
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
