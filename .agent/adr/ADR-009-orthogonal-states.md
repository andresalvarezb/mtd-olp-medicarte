# ADR-009 — Estados ortogonales
**Estado:** ACCEPTED

## Decisión
Persistir por separado habilitación, cobertura, direccionamiento, operación, punto de aplicación, soportes, auditoría y admisión. `process_summary` es solo una proyección de lectura.

## Consecuencia
Las transiciones se implementan en servicios/reglas de dominio y se prueban como combinaciones válidas.

## Implicación de dispensación
La dimensión `operation_status` distingue el hecho reportado por Medicarte de la confirmación posterior de auditoría:

`READY_TO_DISPENSE -> DISPENSATION_REPORTED -> DISPENSED`

`DISPENSED` requiere `audit_status = APPROVED`.

## Punto de aplicación
La logística de la dirección de aplicación constituye una dimensión ortogonal y no se incorpora artificialmente a `operation_status`.

`application_site_status`:
- `PENDING_ASSIGNMENT`
- `ASSIGNED`

Al llegar a `READY_TO_DISPENSE`, el registro espera que Medicarte asigne el punto de aplicación. Esa asignación dispara una notificación a OLP.
