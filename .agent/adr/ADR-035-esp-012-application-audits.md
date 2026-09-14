# ADR-035: ESP-012 final application audit

## Decision

`patient_application` remains the source of truth for the physical event. ESP-012 introduces `patient_application_audits` as a separate, one-time MTD review of a confirmed application. `READY_FOR_AUDIT` is derived when an application is `CONFIRMED` and has no audit row; persisted audit states are `IN_REVIEW`, `APPROVED` and `REJECTED`.

An application can have at most one ESP-012 audit. `APPROVED` and `REJECTED` are terminal; reopening and second audits are out of scope. Starting and deciding use PostgreSQL row locks and optimistic versions so concurrent requests produce one audit and one terminal decision.

## Admission

Only approval can transition the downstream compatibility field `authorization_items.admission_status` to `READY`. Approval and that update, together with the new audit status and audit event, commit atomically. The existing legacy `audit_status` is updated only as a compatibility projection; it is not the source of truth for ESP-012. No legacy logistical fields are reactivated and `operation_status` is not changed.

Rejection leaves the confirmed application, its operational `APPLIED` status, schedule, authorization context and inventory movements unchanged. A rejection is never `NOT_APPLIED` and never creates an inventory movement. Database deferred guards prevent a _new_ transition to `READY` without an approved application audit, and prevent committing an approved audit without `READY` admission. Legacy `READY` rows may keep their historical value; ESP-012 does not reopen them.

Medicarte, OLP and Compensar have no ESP-012 access. `application_audits.read` is granted to MTD_ADMIN, MTD_AUDITORIA, MTD_OPERATOR, MTD_GENERAL and READ_ONLY. Only MTD_ADMIN and MTD_AUDITORIA may start, approve or reject.

## Evidence and scope

The audit read model reconstructs the application, schedule revision, application lines, lot snapshots and `APPLICATION` movements. `evidence_reference` is an optional external reference; ESP-012 does not store binaries or add document-provider integration. No admission states after `READY`, billing, reversal, correction, second audit or reopening are implemented.
