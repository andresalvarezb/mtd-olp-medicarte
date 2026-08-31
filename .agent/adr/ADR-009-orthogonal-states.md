# ADR-009 — Estados ortogonales

**Estado:** ACCEPTED

## Decisión

Persistir por separado habilitación, cobertura, direccionamiento, operación, auditoría y admisión. `admission_status` solo toma `NO_LISTO` y `LISTO`: `LISTO` ("listo para admisión") habilita la descarga de la base para el proceso externo de admisiones; no existen estados de handoff en el núcleo. Los datos logísticos se persisten como campos versionados, pero sus indicadores se derivan; `process_summary` es solo una proyección de lectura. Los valores vigentes del catálogo están documentados en `docs/architecture/estados-backend.md`.

## Consecuencia

Las transiciones se implementan en servicios/reglas de dominio y se prueban como combinaciones válidas.

## Implicación de dispensación

La dimensión `operation_status` distingue la dispensación reportada por OLP de la confirmación posterior de auditoría:

`LISTO_PARA_DISPENSAR -> DISPENSACION_REPORTADA -> DISPENSADO`

`DISPENSADO` requiere `audit_status = APROBADO`.

## Datos operativos derivados

- `lugar_dispensacion` es dato de negocio vigente con historial. `application_site_status` no se persiste: `NULL => PENDIENTE_ASIGNACION`, valor presente `=> ASIGNADO`.
- `fecha_dispensacion` es reportada por OLP. Su primera persistencia produce `DISPENSACION_REPORTADA`.
- `fecha_aplicacion` es reportada por Medicarte y no crea otro estado.
- `support_status` se elimina porque la aplicación no administra archivos ni calcula completitud.

`audit_status` conserva `NO_INICIADO -> LISTO -> EN_REVISION -> APROBADO | RECHAZADO`, con `RECHAZADO -> EN_REVISION` cuando un auditor inicia explícitamente una revisión posterior. Ambas fechas operativas producen `LISTO`, que solo habilita revisión; una acción humana autorizada es la única que decide. La aplicación no infiere aprobación ni completitud documental.
