# SPEC-002 — Estados, cobertura y disponibilidad

**Fases:** 2, 4, 5 y 6

## Dimensiones persistidas

- `enablement_status`
- `coverage_type`
- `direction_status`
- `operation_status`
- `audit_status`
- `admission_status`

`lugar_dispensacion`, `fecha_dispensacion` y `fecha_aplicacion` son datos operativos versionados, no dimensiones de estado independientes. `process_summary` y `application_site_status` son proyecciones de lectura. `support_status` no existe. `admission_status` solo toma `NO_LISTO` y `LISTO`; `LISTO` ("listo para admisión") habilita la descarga de la base para el proceso externo de admisiones y no existen estados de handoff en el núcleo. El catalogo completo del contrato esta en `docs/architecture/estados-backend.md`.

## Cobertura y habilitación

- `normalizar(No.PRESCRIPCION)` vacío produce `PBS`; valor no vacío produce `NO_PBS` (DEC-016). `CUPS_PRINCIPAL` no participa en la clasificación.
- `No.PRESCRIPCION` no vacío debe contener solo dígitos con longitud mayor a 3; en caso contrario la fila se rechaza con `INVALID_FIELD_FORMAT`.
- Normalizar significa trim, mayúsculas y colapso de espacios; no usar contains ni regex semántica.
- `ESTADO_AUTORIZACION == 5` produce `HABILITADO`; cualquier otro valor produce `BLOQUEADO_POR_ESTADO_ORIGEN`.
- PBS usa `direction_status = NO_APLICA`.
- Solo `NO_PBS + HABILITADO` entra a MIPRES.

## Operación

Estados:

- `BLOQUEADO`
- `LISTO_PARA_DISPENSAR`
- `DISPENSACION_REPORTADA`
- `DISPENSADO`

Reglas:

1. `HABILITADO + PBS + NO_APLICA` produce `LISTO_PARA_DISPENSAR`.
2. `HABILITADO + NO_PBS + CONFIRMADO` produce `LISTO_PARA_DISPENSAR`.
3. Cualquier otra combinación previa produce `BLOQUEADO`.
4. La primera persistencia válida de `fecha_dispensacion` por OLP mueve `LISTO_PARA_DISPENSAR -> DISPENSACION_REPORTADA`.
5. Corregir `fecha_dispensacion` conserva `DISPENSACION_REPORTADA` y agrega historial.
6. `audit_status = APROBADO` produce `DISPENSADO`.
7. Ningún proceso automático produce `audit_status = APROBADO`.
8. `fecha_aplicacion` no crea un estado nuevo.
9. Cuando existen `fecha_dispensacion` y `fecha_aplicacion`, `audit_status` pasa de `NO_INICIADO` a `LISTO`; esto habilita revisión, no aprobación.

`LISTO_PARA_DISPENSAR` significa que el ítem superó habilitación, cobertura y direccionamiento; no significa que se haya enviado, aplicado o auditado.

## Estados derivados y eliminados

```text
application_site_status = lugar_dispensacion IS NULL
    ? PENDIENTE_ASIGNACION
    : ASIGNADO
```

Este indicador puede exponerse en API/UI, pero no se persiste. `support_status` se elimina porque la aplicación no conoce los soportes individuales y no debe inferir completitud por conteos o tipos.

## Auditoría

`audit_status` conserva:

```text
  NO_INICIADO -> LISTO -> EN_REVISION -> APROBADO | RECHAZADO
RECHAZADO -> EN_REVISION (inicio explícito de una revisión posterior)
```

La transición a `LISTO` ocurre cuando ambas fechas operativas están persistidas e identifica disponibilidad para revisión humana, no suficiencia automática de soportes. El auditor consulta externamente el Drive, decide y registra actor, fecha, observaciones y hallazgos cuando correspondan. `APROBADO` solo puede partir de una revisión humana iniciada. Tras `RECHAZADO`, solo un auditor puede iniciar explícitamente otra revisión y volver a `EN_REVISION`.

## Actualización explícita de evidencia F2

Una actualización de las cuatro columnas de origen (`NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`) solo puede comenzar cuando el estado actual es `LISTO_PARA_DISPENSAR`. Recalcula la regla previa y persiste `LISTO_PARA_DISPENSAR` o `BLOQUEADO`. No es el mismo contrato que las actualizaciones operativas de ADR-022.

## Prohibiciones

- No persistir `process_summary` como fuente de verdad.
- No crear estados por cada dato operativo cuando pueden derivarse.
- No usar presencia, cantidad o tipo de archivos en Drive para cambiar `audit_status`.
