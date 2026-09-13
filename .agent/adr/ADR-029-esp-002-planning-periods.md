# ADR-029 — Períodos de planificación (ESP-002)

## Estado

Aceptada.

## Contexto

ESP-001 creó `planning_periods` como esqueleto persistente con rango, fechas
límite y estado. ESP-002 debe convertirla en una entidad operativa: validaciones,
máquina de estados, prevención de solapamientos, API, auditoría y UI, sin
adelantar programación, compras, entregas ni inventario.

## Decisiones

### Scope global del período

Existe un único calendario operativo compartido por MTD, OLP y Medicarte. La
unidad de planificación es el período completo, no un período por organización.
Crear períodos por organización rompería la consolidación de demanda (ESP-004),
que necesita una única identidad de período para agregar por punto y código
comercial. Por eso:

- `planning_periods` no tiene `organization_id`.
- El anti-solapamiento es global: dos períodos no pueden compartir ningún día.
- El control de acceso se resuelve con RBAC (permisos del módulo) y no con
  partición de datos.

### Anti-solapamiento en PostgreSQL

Se implementa con una constraint de exclusión:

```sql
EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
```

- El rango es inclusivo `[]`; dos períodos contiguos (fin + 1 día) no se
  solapan, lo que permite cadenas semanales consecutivas.
- No requiere `btree_gist` porque el rango es la única clave de la exclusión.
- Es la única fuente de verdad para la invariante: la API pre-valida para dar
  un error claro, pero la constraint protege ante concurrencia.
- Alternativa descartada: partición por organización con índice GiST compuesto
  (`btree_gist`). Se descartó por el scope global definido arriba.

### Máquina de estados unidireccional y explícita

```text
OPEN → PLANNING_CLOSED → PURCHASING → IN_FULFILLMENT → OPERATIONAL → CLOSED
```

- Solo se permite avanzar una etapa; no hay retrocesos ni saltos.
- Cada transición exige una acción humana auditada.
- La máquina vive como dato compartido en `@authorization/contracts`
  (`planningPeriodTransitions`) y como función pura en `@authorization/domain`.
- El estado `CLOSED` es terminal.

### Congelamiento estructural

- `start_date` y `end_date` solo son editables en `OPEN` y `PLANNING_CLOSED`.
- A partir de `PURCHASING` se congelan.
- Se valida en el dominio, en el servicio (dentro del lock transaccional) y en
  un trigger PostgreSQL como red de seguridad.
- El resto de fechas (corte, límite de OC, entrega esperada) sigue siendo
  mantenible con validación y auditoría, porque la operación puede requerir
  ajustes de abastecimiento posteriores al cierre de programación.

### Campo `scheduling_cutoff_at`

La columna ESP-001 `programming_deadline_at` se renombra a
`scheduling_cutoff_at` para alinearla con la nomenclatura funcional de ESP-002
(fecha límite de programación de Medicarte). La migración es aditiva respecto al
histórico y no destruye datos.

### Validación de entrega esperada

`purchase_order_deadline_at` es un instante y `expected_delivery_date` es una
fecha calendario. La comparación usa la fecha de America/Bogota:

```sql
(timezone('America/Bogota', purchase_order_deadline_at))::date <= expected_delivery_date
```

Colombia no aplica horario de verano, por lo que la conversión es estable. La
función `timezone(text, timestamptz)` es inmutable y puede usarse en un CHECK.

### RBAC mínimo

Se añaden únicamente los permisos del módulo, reutilizando el modelo actual de
usuarios, organizaciones, roles y permisos:

- `planning_periods.read`: MTD_ADMIN, MTD_OPERATOR, MTD_GENERAL, MTD_AUDITORIA,
  READ_ONLY.
- `planning_periods.manage`: MTD_ADMIN, MTD_OPERATOR.

No se implementa alcance por organización o por punto; eso corresponde a
ESP-015.

### Auditoría

Creación, modificación y transición registran un evento en `audit_events` dentro
de la misma transacción que cambia el período, con actor, organización,
correlación, estado anterior y posterior. No existen escrituras parciales sin
auditoría.

## Consecuencias

Positivas:

- La ventana operativa es única, consistente y protegida en base de datos.
- Los estados avanzan solo por acciones auditadas.
- La programación futura (ESP-003) puede clasificar ON_TIME/LATE con una regla
  pura y determinista.
- El histórico legacy de `authorization_items` no se toca.

Costos:

- Toda creación de períodos futuros debe respetar la constraint de exclusión.
- Ajustar un rango ya congelado requiere intervención manual de base de datos,
  lo cual es intencional.
- Las fechas límite siguen editables después del cierre de programación; la
  responsabilidad de mantenerlas coherentes recae en la validación + auditoría.
