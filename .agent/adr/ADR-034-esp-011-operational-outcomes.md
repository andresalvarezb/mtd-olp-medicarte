# ADR-034: ESP-011 operational outcomes

## Decision

ESP-011 mantiene tres entidades distintas: `patient_schedule` representa la planificación, `patient_application` representa la administración física confirmada y `patient_schedule_outcomes` registra el resultado operacional de una revisión que no terminó en aplicación. `noveltyCode` es una razón y nunca un estado.

El estado operacional se deriva con esta precedencia: una aplicación `CONFIRMED` produce `APPLIED`; un outcome `NOT_APPLIED` produce `NOT_APPLIED`; una programación cancelada produce `CANCELLED`; en cualquier otro caso produce `SCHEDULED`. El planning status continúa usando exclusivamente `SCHEDULED`, `RESCHEDULED` y `CANCELLED`.

Los outcomes son append-only, están ligados a `(patient_schedule_id, schedule_revision)` y solo puede existir un outcome terminal por revisión. `APPLIED` no se duplica en outcomes: su única fuente es `patient_application CONFIRMED`. La exclusión entre aplicación confirmada y outcome se protege mediante locking transaccional común por programación y revisión.

## Product disposition

`NOT_PREPARED` y `REUSABLE` no escriben movimientos. En particular, `REUSABLE` no crea un movimiento positivo porque nunca hubo reserva ni salida por preparación. `NON_REUSABLE` registra snapshots por lote y crea un movimiento negativo `NON_REUSABLE` con `source_type = OUTCOME_LINE`; el ledger PostgreSQL sigue siendo la fuente de verdad y no existe `RESERVED`.

La cantidad no reutilizable no puede superar la cantidad programada ni el saldo usable bloqueado del lote. Los lotes se bloquean en orden determinista para que dos outcomes concurrentes no produzcan saldo negativo. Los reintentos son idempotentes por la semántica única del movimiento.

## Scope

Solo Medicarte puede registrar `NOT_APPLIED`. MTD puede consultar el read model y los outcomes; OLP y Compensar no tienen acceso inicial. `AUTHORIZATION_CANCELLED` solo registra una razón operacional y no modifica `authorization_item`.

No se implementan auditoría final MTD, admission READY, reversión de aplicaciones confirmadas, devoluciones a proveedor, ajustes manuales, stock preparado transitorio ni reservas.

## UX hardening

La vista de programaciones pendientes expone las dos acciones terminales, `APLICAR` y `MARCAR NO APLICADO`, usando el read model operacional para ocultar la acción incompatible cuando ya existe un resultado terminal. `NON_REUSABLE` requiere seleccionar físicamente uno o varios lotes elegibles y declarar cantidades; la UI no reserva stock. El backend continúa revalidando producto, punto, vencimiento y saldo usable, y los conflictos por concurrencia refrescan el estado sin reintentar automáticamente.
