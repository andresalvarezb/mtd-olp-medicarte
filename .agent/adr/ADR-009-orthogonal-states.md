# ADR-009 — Estados ortogonales

**Estado:** ACCEPTED

## Decisión

Persistir por separado habilitación, cobertura, direccionamiento, operación, auditoría y admisión. `admission_status` solo toma `NOT_READY` y `READY`: `READY` ("listo para admisión") habilita la descarga de la base para el proceso externo de admisiones; no existen estados de handoff en el núcleo. Los datos logísticos se persisten como campos versionados, pero sus indicadores se derivan; `process_summary` es solo una proyección de lectura.

## Consecuencia

Las transiciones se implementan en servicios/reglas de dominio y se prueban como combinaciones válidas.

## Implicación de dispensación

La dimensión `operation_status` distingue la dispensación reportada por OLP de la confirmación posterior de auditoría:

`READY_TO_DISPENSE -> DISPENSATION_REPORTED -> DISPENSED`

`DISPENSED` requiere `audit_status = APPROVED`.

## Datos operativos derivados

- `lugar_dispensacion` es dato de negocio vigente con historial. `application_site_status` no se persiste: `NULL => PENDING_ASSIGNMENT`, valor presente `=> ASSIGNED`.
- `fecha_dispensacion` es reportada por OLP. Su primera persistencia produce `DISPENSATION_REPORTED`.
- `fecha_aplicacion` es reportada por Medicarte y no crea otro estado.
- `support_status` se elimina porque la aplicación no administra archivos ni calcula completitud.

`audit_status` conserva `NOT_STARTED -> READY -> IN_REVIEW -> APPROVED | REJECTED`, con `REJECTED -> IN_REVIEW` cuando un auditor inicia explícitamente una revisión posterior. Ambas fechas operativas producen `READY`, que solo habilita revisión; una acción humana autorizada es la única que decide. La aplicación no infiere aprobación ni completitud documental.
