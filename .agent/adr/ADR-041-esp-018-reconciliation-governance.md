# ADR-041 — ESP-018 Governance de findings de reconciliación

Estado: implemented / pending review  
Fecha: 2026-09-15

## Contexto

ESP-017 produce `reconciliation_runs` y `reconciliation_findings`: evidencia puntual de un scan. La misma inconsistencia en 20 runs no debe aparecer como 20 problemas operativos independientes. ESP-018 añade una identidad persistente de governance sin cambiar la verdad técnica del reconciler.

La aplicación todavía no tiene nombre oficial. PostgreSQL sigue siendo source of truth.

## Decisión

### Tres conceptos separados

| Concepto | Tabla                     | Semántica                                        |
| -------- | ------------------------- | ------------------------------------------------ |
| RUN      | `reconciliation_runs`     | ejecución puntual del reconciler                 |
| FINDING  | `reconciliation_findings` | observación inmutable de un run                  |
| ISSUE    | `reconciliation_issues`   | identidad persistente a través de múltiples runs |

Finding ≠ issue. El finding permanece como evidence. El issue agrupa ocurrencias. No se borran findings históricos. No hay `DELETE issue` en API.

### Identidad

```
tenant_id + rule_code + fingerprint
```

El fingerprint es el de ESP-017. No se usa el mensaje humano. No se usa únicamente `entity_id`. `run_id` no forma parte de la identidad. `rule_version` no crea un issue distinto si `ruleCode + fingerprint` coinciden; el issue guarda `first_rule_version` / `last_rule_version`.

Si una versión nueva de regla produce otro fingerprint, es otro issue. No hay fusión automática.

### Relación finding → issue

`reconciliation_findings.issue_id` FK → `reconciliation_issues.id` (`ON DELETE RESTRICT`). Todo finding nuevo ESP-018 nace con `issue_id`. El writer ESP-017, en la misma transacción:

1. `INSERT … ON CONFLICT (tenant_id, rule_code, fingerprint) DO NOTHING`
2. `SELECT … FOR UPDATE`
3. aplica recurrence
4. inserta el finding con `issue_id`

`last_finding_id` y `finding_id` en events usan FK `DEFERRABLE INITIALLY DEFERRED` porque el finding se inserta después de apuntar el issue.

Dos runs concurrentes con el mismo fingerprint convergen a 1 issue y 2 findings. `occurrence_count` no se pierde: el lock serializa el incremento.

### Backfill

Migración `0050_esp018_reconciliation_governance.sql` agrupa findings históricos por `tenant_id + rule_code + fingerprint`, crea issues `OPEN` (no inventa ACKNOWLEDGED / RESOLVED / ACCEPTED_RISK), vincula `issue_id` y falla si queda un finding huérfano o si `SUM(occurrence_count) ≠ COUNT(findings)`.

### Lifecycle

Estados persistidos: `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `ACCEPTED_RISK`. `REOPENED` es evento, no estado.

```
NEW FINDING                         → OPEN
OPEN                                → ACKNOWLEDGED | ACCEPTED_RISK | RESOLVED
ACKNOWLEDGED                        → ACCEPTED_RISK | RESOLVED
RESOLVED + recurrence               → OPEN  (ISSUE_REOPENED)
ACCEPTED_RISK + misma severity/rule → ACCEPTED_RISK
ACCEPTED_RISK + severity mayor
  o ruleVersion distinta            → OPEN  (RISK_ACCEPTANCE_INVALIDATED)
RESOLVED | ACCEPTED_RISK + reopen   → OPEN  (ISSUE_MANUALLY_REOPENED)
```

No hay transiciones implícitas adicionales. Ausencia en un run posterior **no** auto-resuelve: el run puede estar scoped, la regla `NOT_APPLICABLE`, o el dominio no evaluado. `last_seen_at` es evidencia, no un close.

`OPEN` significa detectado y sin clasificación terminal. No implica que alguien ya investigue.

`ACKNOWLEDGED` es activo. No cambia finding, severity, run, datos operacionales, CLI ni release health.

`RESOLVED` requiere `resolutionCode` de catálogo (`DATA_CORRECTED`, `PROCESS_CORRECTED`, `RULE_UPDATED`, `NO_LONGER_APPLICABLE`, `OTHER`) y nota no vacía. `OTHER` exige nota detallada. Resolver **no** muta el dominio. ESP-018 presupone que la corrección ocurrió por el flujo del módulo.

`ACCEPTED_RISK` requiere reason, guarda `accepted_risk_severity` y `accepted_risk_rule_version`, y opcionalmente `risk_review_at`. Significa: MTD conoce la inconsistencia y la tolera temporalmente. **No** significa dato correcto, finding eliminado, reconciler ignorándolo, CLI en verde, release gate en verde, ni regla deshabilitada.

### No suppression

ESP-017 sigue generando el finding. Contadores de run (`critical_findings`, `error_findings`, …) siguen siendo raw. CLI: exit 0 sin CRITICAL/ERROR, exit 1 si hay CRITICAL/ERROR, exit 2 error técnico. `ACCEPTED_RISK` no cambia esos códigos. Un finding CRITICAL con issue `ACCEPTED_RISK` sigue siendo CRITICAL para el release gate.

### Risk review

`risk_review_at` es informativo. Si venció, el read model muestra `RISK_REVIEW_OVERDUE`. No cambia el status. No hay scheduler. No hay email, Slack, Teams, SMS ni webhooks.

### Assignment y comments

`assigned_to_user_id` es ownership operativo, no autorización. Primero RBAC, luego visibilidad. Solo usuarios activos del tenant MTD con roles de governance interno (`MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY`, `MTD`). No Medicarte, OLP ni Compensar.

Comments append-only, máximo 2000 caracteres, sin adjuntos. La UI advierte: no incluir datos clínicos o personales innecesarios. Audit guarda `commentId`, no el body. Logs no registran el body.

### Concurrencia

`reconciliation_issues.version` es optimistic concurrency. Acciones mutantes (salvo comments) reciben `expectedVersion`. Conflicto → `409 VERSION_CONFLICT`.

### Source of truth

- technical truth: `reconciliation_findings` / dominio operacional
- governance truth: `reconciliation_issues`

Un issue `RESOLVED` no borra un finding. Un issue `ACCEPTED_RISK` no convierte un finding CRITICAL en INFO.

Únicas tablas escribibles por reconciliación: `reconciliation_runs`, `reconciliation_findings`, `reconciliation_issues`, `reconciliation_issue_events`, `reconciliation_issue_comments`. Acknowledge / assign / resolve / accept-risk no ejecutan `UPDATE` sobre tablas operacionales.

### RBAC

| Rol                         | read | comment | triage |
| --------------------------- | ---- | ------- | ------ |
| MTD_ADMIN                   | sí   | sí      | sí     |
| MTD_AUDITORIA               | sí   | sí      | sí     |
| MTD_OPERATOR                | sí   | sí      | no     |
| MTD_GENERAL                 | sí   | no      | no     |
| READ_ONLY                   | sí   | no      | no     |
| MEDICARTE / OLP / COMPENSAR | no   | no      | no     |

Tenant isolation: issue de A no es visible ni mutable por B.

### Fuera de alcance

- auto-repair y botones de reparación de dominio
- mute / ignore / disable rule desde UI
- scheduler / cron / BullMQ recurring
- alerting externo
- convertir ACCEPTED_RISK en PASS técnico
- auto-close por ausencia en un run posterior

## Consecuencias

La UI `/integridad` tiene pestañas Runs e Issues. El health del run permanece crudo. Governance es una capa encima, no un substituto del reconciler.
