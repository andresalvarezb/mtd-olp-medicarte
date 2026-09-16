# ADR-042 — ESP-019 Operación programada y alertamiento controlado de reconciliación

Estado: implemented / pending review  
Fecha: 2026-09-15

## Contexto

El reconciler desarrollado en ESP-017 y gobernado en ESP-018 era una herramienta invocable bajo demanda. Para garantizar la integridad continua en producción sin depender de ejecuciones manuales ad-hoc, se requiere una capacidad operacional programada, segura, con exclusión de concurrencia y un sistema de alertamiento controlado.

La aplicación todavía no tiene nombre oficial. PostgreSQL continúa siendo la única fuente de verdad y autoridad.

## Principios y Separación de Responsabilidades

1. **ESP-017 continúa siendo la autoridad técnica de detección**: Define qué es inconsistente y genera runs y findings inmutables sobre un snapshot PostgreSQL `REPEATABLE READ READ ONLY`.
2. **ESP-018 continúa siendo la autoridad de governance de issues**: Agrupa recurrencias en issues persistentes (`tenant_id + rule_code + fingerprint`), gestiona su ciclo de vida y previene silenciamientos arbitrarios.
3. **ESP-019 decide cuándo ejecutar y cuándo notificar**: No modifica reglas de detección, no auto-repara datos, no altera severidades de findings, no convierte `ACCEPTED_RISK` en `PASS`, no altera los exit codes del reconciler y no introduce un segundo scheduler autoritativo.

## Decisiones Técnicas

### 1. PostgreSQL como Autoridad y Fuente de Verdad

Aun si Redis o BullMQ se emplean para transporte o wake-up ligero, PostgreSQL mantiene la persistencia autoritativa de:

- Políticas de operación (`reconciliation_operation_policies`).
- Ejecuciones operacionales (`reconciliation_operation_executions`).
- Claims, leases y fencing tokens.
- Notificaciones operacionales in-app (`reconciliation_notifications`).

### 2. Modelo de Políticas (`reconciliation_operation_policies`)

- Máximo una política activa por tenant (`UNIQUE(tenant_id)`).
- Cadencias soportadas: `DAILY`, `WEEKLY` (con `weekday` 1..7), y `MANUAL`.
- Timezone estándar inicial: `America/Bogota` (calculado mediante `Intl.DateTimeFormat` nativo).
- Umbrales de alerta: `CRITICAL`, `ERROR`, `WARNING`, `NONE`.
- Concurrencia optimista con campo `version` y control transaccional de slots (`next_run_at`).
- Deshabilitada por defecto en bootstrap y sin políticas auto-insertadas en migraciones.

### 3. Planificación Lógica Exactly-Once y Coalescencia

- Restricción única `UNIQUE(tenant_id, policy_id, scheduled_for)` para triggers programados.
- Coalescencia de slots perdidos (_missed runs_): Si el sistema estuvo inactivo, no se generan ráfagas de ejecuciones atrasadas; se materializa únicamente el slot más reciente con `missed_occurrences_count` incrementado para auditoría.

### 4. No Solapamiento (No-Overlap), Leases y Fencing

- **Exclusión mutua tenant-level**: No se permite más de una ejecución operacional activa (`CLAIMED` o `RUNNING` con lease vigente) o run de reconciliación en progreso por tenant. Un trigger manual durante una ejecución activa devuelve `409 Conflict`; una ejecución programada solapada se registra con estado `SKIPPED` y motivo `OVERLAPPING_EXECUTION`.
- **Claim atómico**: Adquisición mediante `UPDATE ... WHERE id = $1 AND (status = 'PENDING' OR (status IN ('CLAIMED', 'RUNNING') AND lease_expires_at < now()))`.
- **Fencing token y generación**: Cada claim incrementa `claim_generation` y genera un `claim_token` UUID.
- **Transiciones cercadas**: `startExecution`, `completeExecution`, `failExecution` y `renewLease` exigen coincidencia estricta de `(execution_id, claim_token, claim_generation)`.
- **Protección contra workers obsoletos**: Un worker que pierde el lease (por GC pause o lentitud de red) y cuyo claim fue reclamado por otro worker ve rechazadas sus escrituras y aborta silenciosamente sin corromper el estado.
- **Heartbeat**: Renovación periódica de lease en background mientras el engine se ejecuta.

### 4.1 Cardinalidad Estricta y Vínculo Canónico Execution ↔ Run

- **Vínculo Canónico Unidireccional**: `reconciliation_runs.operation_execution_id -> reconciliation_operation_executions.id`.
- Se elimina `reconciliation_operation_executions.reconciliation_run_id` para erradicar cualquier posibilidad de punteros divergentes o desalineación entre tablas.
- **Restricción UNIQUE Parcial en DB**:
  `CREATE UNIQUE INDEX "reconciliation_runs_operation_execution_unique" ON "reconciliation_runs" ("operation_execution_id") WHERE "operation_execution_id" IS NOT NULL;`
  - Garantiza físicamente que una `reconciliation_operation_execution` solo puede tener un único `reconciliation_run`.
  - Múltiples runs manuales legacy (ESP-017) con `operation_execution_id = NULL` continúan plenamente permitidos.
  - Concurrencia a nivel PostgreSQL rechaza cualquier intento de insertar un segundo run para la misma execution con violación controlada de unicidad.
- **Complementariedad Fencing + DB UNIQUE**: El fencing token previene que workers obsoletos (stale) muten el estado operacional, mientras que el índice UNIQUE de PostgreSQL previene físicamente la duplicación del run incluso ante anomalías o fallos de aplicación concurrentes.

### 5. Recuperación ante Caídas (Crash Recovery)

- Si un worker cae tras reclamar pero antes de iniciar el scan, el lease expira y la ejecución es reclamada limpiamente.
- Si un worker cae tras haber creado el `reconciliation_run`, el siguiente worker detecta la existencia de `reconciliation_runs.operation_execution_id` y reconcilia el resultado sin re-ejecutar innecesariamente el scan.

### 6. Distinción: Fallo Operacional vs Salud del Reconciler

- `executionStatus` (`COMPLETED`, `FAILED`, `PENDING`, `CLAIMED`, `RUNNING`, `CANCELLED`, `SKIPPED`): Mide la infraestructura y orquestación técnica.
- `runHealth` (`HEALTHY`, `UNHEALTHY`): Mide la integridad de los datos de negocio evaluados.
- **Regla estricta**: Findings de severidad `CRITICAL` o `ERROR` resultan en un run `UNHEALTHY`, pero la ejecución operacional finaliza como `COMPLETED`. Solo fallos técnicos reales (caída de BD, timeout de statement, error de conectividad) resultan en `FAILED` con hasta 3 reintentos controlados.

### 7. Alertamiento Controlado, Agrupado y Deduplicado

- Alertas resumidas por run, nunca por finding individual.
- `dedup_key` único por notificación para evitar ruido y spam.
- Canal primario in-app durable persistido en `reconciliation_notifications`.
- Notificación de recuperación (`RECONCILIATION_RECOVERY`): Se emite únicamente en la transición de un run `UNHEALTHY` a uno `HEALTHY` sobre scopes comparables, evitando notificaciones repetitivas en sistemas que operan normalmente limpios.
- Notificación de fallo técnico (`RECONCILIATION_TECHNICAL_FAILURE`): Notifica errores de infraestructura cuando la política lo habilita.
- Riesgo aceptado vencido (`RISK_REVIEW_OVERDUE`): Genera condición informativa sin mutar silenciosamente el issue ni cambiar su severidad.
- Protección de datos sensibles: Prohibición absoluta de incluir datos de pacientes o PHI en los payloads JSON de notificaciones.

### 8. Seguridad y RBAC

- Permisos granulares:
  - `reconciliation_operations.read`: Lectura de políticas e historial de ejecuciones (roles MTD).
  - `reconciliation_operations.manage`: Modificación de políticas y cancelación de ejecuciones (solo `MTD_ADMIN`).
  - `reconciliation_notifications.read`: Lectura y marcado de notificaciones in-app.
- Aislamiento total: Organizaciones operativas como Medicarte, OLP y Compensar tienen acceso denegado (`403 Forbidden`).
- Configuración de entorno: Variable `RECONCILIATION_SCHEDULER_ENABLED` con valor por defecto `false` en desarrollo y test.
