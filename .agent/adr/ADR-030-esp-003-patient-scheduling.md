# ADR-030 — Programación de pacientes (ESP-003)

## Estado

Aceptada.

## Contexto

ESP-001 separó el dominio clínico (`authorization_items`) del logístico y creó
`patient_schedules` / `patient_schedule_history`. ESP-002 hizo operativo
`planning_periods` con corte de programación y la regla pura
`classifyScheduleTiming`. ESP-003 convierte la programación de Medicarte en la
intención operativa que luego alimentará la demanda consolidada de ESP-004, sin
adelantar compras, inventario ni entrega.

## Decisiones

### Invariante de alcance

Programar un paciente **solo** registra la intención de aplicar un producto
autorizado (cantidad, punto, fecha y período):

- no crea ni reserva inventario;
- no crea ni modifica órdenes de compra;
- no escribe `projected_demand_lines` ni `demand_sources`;
- no modifica ningún campo de `authorization_items` (ni legacy ni operativo).

La evidencia de estas invariantes queda cubierta por el gate de integración
(casos 24–27).

### Estados y máquina de estados

```text
SCHEDULED ──► RESCHEDULED ──► RESCHEDULED (n veces)
    │              │
    └──────────────┴────────► CANCELLED (terminal)
```

- `APPLIED` pertenece a ESP-010 y `NO_SHOW` a ESP-011; no se introducen aquí.
- Cancelar no elimina la fila: cambia `status` y agrega una revisión.
- La tabla de transiciones vive en `@authorization/contracts`
  (`patientScheduleTransitions`) y la función pura en `@authorization/domain`.

### `revision` es historial y token de concurrencia

`patient_schedules.revision` cumple doble rol:

1. número del snapshot en `patient_schedule_history` (append-only, único por
   programación);
2. token de concurrencia optimista: las mutaciones exigen `expectedRevision` y
   comparan con la revisión bloqueada con `FOR UPDATE`.

Toda mutación material ocurre en una única transacción: lock, validación de
revisión, `update`, snapshot `revision+1`, `audit_event`. Un cambio sin efecto
no incrementa la revisión.

### Timing reutiliza la regla de ESP-002

- `classifyScheduleTiming(period, now)` es la única regla temporal. La API la
  invoca, no la duplica en contratos ni frontend.
- El resultado se congela en `schedule_timing` al programar para conservar la
  identificación histórica de las programaciones tardías.
- Al reprogramar se recalcula contra el corte del período de la nueva fecha.
- El frontend consume `GET /patient-schedules/timing-preview` para mostrar
  ON_TIME/LATE antes de guardar.

### Programación extemporánea (LATE)

`late_handling` es **obligatorio** cuando `schedule_timing = LATE` y nulo en
ON_TIME (CHECK en base de datos además de la validación de dominio):

- `COMPLEMENTARY_PURCHASE_ORDER`: intención de OC complementaria. ESP-003 no
  crea ni modifica la OC; ESP-005 la materializará.
- `NEXT_PERIOD`: la materialización se difiere. Se valida y persiste el período
  que recibirá la programación en `deferred_planning_period_id`, tomado como el
  primer período cuyo `start_date` es posterior al `end_date` del período
  original. Si no existe, la operación se rechaza
  (`PATIENT_SCHEDULE_NEXT_PERIOD_NOT_FOUND`). ESP-004 decidirá cómo consolidar
  esa intención en el período diferido.

### Prioridad por vencimiento

- La fecha se lee del read model clínico
  (`ClinicalAuthorizationRepository`), que es el único módulo que conoce el
  campo fuente en `source_data` (`FECHA_FINAL_VIGENCIA`) y la expone ya
  normalizada como `authorizationExpiresOn`; el dominio y los servicios de
  programación no conocen el nombre del campo.
- `calculateAuthorizationPriority(expiration, today, policy)` recibe la
  política como parámetro explícito (`ScheduleExpirationPolicy`); el default
  es `SCHEDULE_EXPIRATION_THRESHOLDS` (`@authorization/contracts`), fuente
  única compartida API/Web con los valores OPERATIVOS INICIALES
  (configurables, no regla contractual permanente):

| Días restantes            | Nivel    |
| ------------------------- | -------- |
| `<= 15` (incluye vencida) | CRITICAL |
| `<= 30`                   | HIGH     |
| `> 30`                    | NORMAL   |
| sin dato                  | sin alerta |

Cambiar la política no requiere modificar el dominio: es un parámetro; los
umbrales congelados con `Object.freeze` hacen el ajuste visible y auditable.

- `days_until_expiration` y `priority_level` son derivados de lectura; no se
  persisten para no quedar obsoletos.
- La alerta **no** reserva stock, no reordena pacientes y no bloquea por sí
  misma. Solo bloquean la programación las reglas clínicas existentes
  (`ENABLED`, dirección MIPRES coherente con PBS/NO_PBS y autorización no
  vencida).

### Período derivado de la fecha

La creación no acepta `planning_period_id`: la fecha programada determina el
período por cobertura (`start_date <= fecha <= end_date`). De esta forma la API,
la carga XLSX y la UI comparten una sola regla y no pueden desincronizarse. Un
corte temporal no puede afectar la fecha del paciente porque el período es
anterior a la clasificación.

### Consistencia transaccional con la autorización

La carrera entre leer la elegibilidad del `authorization_item` y crear/editar
la programación se cierra dentro de la MISMA transacción:

- `SELECT ... FOR UPDATE` sobre la fila de `authorization_items` (y sobre la
  fila de `patient_schedules` ya existente en mutaciones);
- re-evaluación de las reglas clínicas DESPUÉS de adquirir el lock (con
  READ COMMITTED la relectura post-lock ve el último estado confirmado);
- solo entonces se persisten schedule + history + audit.

Se aplica a la operación individual (crear, reprogramar/editar) y a la
confirmación por fila de la carga XLSX. También se bloquea la fila del período
cubierta por la fecha nueva. Los FK quedan como red de seguridad, no como
única defensa: el gate incluye una prueba de carrera con una transacción
externa que bloquea la autorización mientras se programa.

### Identidad canónica y duplicados (pre-ESP-004)

Dos lotes XLSX independientes podían confirmar concurrentemente programaciones
semánticamente equivalentes; el claim `confirmable` solo protege filas dentro
del mismo lote. La identidad canónica de una programación es:

```text
authorization_item_id + dispensing_point_id + scheduled_date
```

mientras el status esté activo (`SCHEDULED`/`RESCHEDULED`); cancelar libera la
identidad. Esta es la INVARIANTE DE NEGOCIO VIGENTE:

- `quantity` representa las unidades autorizadas planeadas para ese evento de
  aplicación y NO es parte de la identidad;
- la revisión tampoco distingue programaciones;
- si el negocio requiere algún día varios eventos de aplicación independientes
  para la misma terna, el modelo debe introducir una dimensión de ocurrencia
  explícita (`scheduled_at` / `session` / `occurrence_id`); quantity y
  revision nunca se usan para eso. La invariante vive en la base de datos con un índice único parcial
(`patient_schedules_active_identity_idx`, migración 0034) y la API traduce la
violación (23505) a conflictos estructurados `PATIENT_SCHEDULE_DUPLICATE` /
`DUPLICATE_EXISTING_SCHEDULE`. Consecuencias:

- las escrituras directas, individuales y de cualquier lote comparten la
  misma barrera transaccional;
- el staging de XLSX sigue marcando `DUPLICATE_EXISTING_SCHEDULE` como
  advertencia temprana, pero no es la única defensa;
- ESP-004 nunca tendrá que deduplicar: cada programación activa es unívoca
  por identidad y las revisiones conservan la misma identidad salvo cambio
  de fecha/punto.

### Historial append-only

`patient_schedule_history` conserva cada revisión con fecha, punto, cantidad,
estado, timing, manejo tardío y período diferido, más actor y correlación. Los
triggers `patient_schedule_history_no_update` / `no_delete` impiden mutarlo.
La reconstrucción `revision 1 → 2 → 3` es la fuente de lineage para ESP-004.

### API y RBAC

Endpoints REST bajo `/patient-schedules` (incluye historial, búsqueda clínica
acotada, puntos, preview de timing, plantilla y carga XLSX). El controller solo
valida contratos y delega en servicios; la lógica de negocio vive en el dominio
y en los servicios.

Matriz inicial:

| Rol               | `patient_schedules.read` | `patient_schedules.manage` |
| ----------------- | ------------------------ | -------------------------- |
| MEDICARTE_OPERATOR| Sí                       | Sí                         |
| MTD_ADMIN         | Sí                       | No                         |
| MTD_OPERATOR      | Sí                       | No                         |
| MTD_GENERAL       | Sí                       | No                         |
| MTD_AUDITORIA     | Sí                       | No                         |
| READ_ONLY         | Sí                       | No                         |
| OLP_OPERATOR      | No                       | No                         |
| COMPENSAR_VIEWER  | No (sin cambio)          | No                         |

La búsqueda de autorizaciones de programación es una proyección acotada del
read model clínico (`ClinicalAuthorizationRepository.searchForScheduling`) y
respeta el scope por `authorization_item_organizations` (MTD omite el filtro).
No se agrega un endpoint clínico general duplicado.

### Carga XLSX

Flujo síncrono dentro del request con la arquitectura de staging existente:
XLSX → normalización → validación por fila → `READY_TO_CONFIRM` → preview →
confirmación transaccional por fila.

- Columnas mínimas: `AUTORIZACION`, `DOCUMENTO`, `COD_COMERCIAL`, `CANTIDAD`,
  `PUNTO`, `FECHA_PROGRAMADA`; opcional `MANEJO_TARDIO`. `COD_COMERCIAL` es la
  identidad del producto; la descripción nunca es llave.
- Estados de staging: `VALID`, `INVALID`, `DUPLICATE`, `CONFLICT`, con un
  `result_code` estable para la UI.
- `CONFLICT` agrupa autorizaciones no habilitadas/vencidas y falta de período
  siguiente.
- Éxito parcial: solo se confirman las filas `VALID`; las demás se conservan
  para corrección. La confirmación reclama cada fila con un `UPDATE
  ... WHERE confirmable = true` y escribe programación + historial + auditoría
  en la misma transacción; un fallo por fila se registra como
  `CONFIRMATION_CONFLICT` sin abortar el resto.
- Límite de 20 MB y 5.000 filas; el contenido binario del archivo no permanece
  almacenado tras normalizar (política PHI).

### Auditoría

`PATIENT_SCHEDULE_CREATED`, `PATIENT_SCHEDULE_UPDATED`,
`PATIENT_SCHEDULE_RESCHEDULED`, `PATIENT_SCHEDULE_CANCELLED`, más
`PATIENT_SCHEDULE_IMPORT_CREATED` / `_CONFIRMED`, en `audit_events` y dentro de
la misma transacción que el cambio.

## Consecuencias

Positivas:

- La programación es auditable y reconstruible revisión a revisión.
- ESP-004 puede consumir `patient_schedule_history` sin tocar datos clínicos.
- La regla temporal y los umbrales de vencimiento están centralizados.
- OLP y Compensar no acceden a datos clínicos de programación.

Costos y límites:

- El procesamiento XLSX es síncrono; cargas cercanas al límite de 5.000 filas
  ocupan el request. Si la operación crece, deberá migrarse a la cola/worker
  sin cambiar el contrato de staging.
- `NEXT_PERIOD` solo registra la intención y el período destino; su
  materialización se decide en ESP-004.
- La identidad canónica se codifica también como dato compartido
  (`PATIENT_SCHEDULE_IDENTITY_FIELDS`, contratos); ampliarla o sustituirla
  exige una decisión explícita con dimensión de ocurrencia, no un uso
  creativo de quantity/revision.
- La concurrencia optimista se resuelve por revisión; dos reprogramaciones
  simultáneas se rechazan en vez de fusionarse.
