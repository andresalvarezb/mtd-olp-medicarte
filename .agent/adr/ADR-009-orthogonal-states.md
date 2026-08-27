# ADR-009 — Estados ortogonales
**Estado:** ACCEPTED

## Decisión
Persistir por separado habilitación, cobertura, direccionamiento, operación, soportes, auditoría y admisión. `process_summary` es solo una proyección de lectura.

## Consecuencia
Las transiciones se implementan en servicios/reglas de dominio y se prueban como combinaciones válidas.

## Implicación de dispensación
La dimensión `operation_status` distingue el hecho reportado por Medicarte de la confirmación posterior de auditoría:

`READY_TO_DISPENSE -> DISPENSATION_REPORTED -> DISPENSED`

`DISPENSED` requiere `audit_status = APPROVED`.
