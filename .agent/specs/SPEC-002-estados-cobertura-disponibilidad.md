# SPEC-002 — Estados, cobertura y disponibilidad

**Fases:** 2, 4, 5 y 6

## Dimensiones persistidas

- `enablement_status`
- `coverage_type`
- `direction_status`
- `operation_status`
- `audit_status`
- `admission_status`

`lugar_dispensacion`, `fecha_dispensacion` y `fecha_aplicacion` son datos operativos versionados, no dimensiones de estado independientes. `process_summary` y `application_site_status` son proyecciones de lectura. `support_status` no existe.

## Cobertura y habilitación

- `normalizar(No.PRESCRIPCION)` vacío produce `PBS`; valor no vacío produce `NO_PBS` (DEC-016). `CUPS_PRINCIPAL` no participa en la clasificación.
- `No.PRESCRIPCION` no vacío debe contener solo dígitos con longitud mayor a 3; en caso contrario la fila se rechaza con `INVALID_FIELD_FORMAT`.
- Normalizar significa trim, mayúsculas y colapso de espacios; no usar contains ni regex semántica.
- `ESTADO_AUTORIZACION == 5` produce `ENABLED`; cualquier otro valor produce `BLOCKED_SOURCE_STATUS`.
- PBS usa `direction_status = NOT_APPLICABLE`.
- Solo `NO_PBS + ENABLED` entra a MIPRES.

## Operación

Estados:

- `BLOCKED`
- `READY_TO_DISPENSE`
- `DISPENSATION_REPORTED`
- `DISPENSED`

Reglas:

1. `ENABLED + PBS + NOT_APPLICABLE` produce `READY_TO_DISPENSE`.
2. `ENABLED + NO_PBS + CONFIRMED` produce `READY_TO_DISPENSE`.
3. Cualquier otra combinación previa produce `BLOCKED`.
4. La primera persistencia válida de `fecha_dispensacion` por OLP mueve `READY_TO_DISPENSE -> DISPENSATION_REPORTED`.
5. Corregir `fecha_dispensacion` conserva `DISPENSATION_REPORTED` y agrega historial.
6. `audit_status = APPROVED` produce `DISPENSED`.
7. Ningún proceso automático produce `audit_status = APPROVED`.
8. `fecha_aplicacion` no crea un estado nuevo.
9. Cuando existen `fecha_dispensacion` y `fecha_aplicacion`, `audit_status` pasa de `NOT_STARTED` a `READY`; esto habilita revisión, no aprobación.

`READY_TO_DISPENSE` significa que el ítem superó habilitación, cobertura y direccionamiento; no significa que se haya enviado, aplicado o auditado.

## Estados derivados y eliminados

```text
application_site_status = lugar_dispensacion IS NULL
    ? PENDING_ASSIGNMENT
    : ASSIGNED
```

Este indicador puede exponerse en API/UI, pero no se persiste. `support_status` se elimina porque la aplicación no conoce los soportes individuales y no debe inferir completitud por conteos o tipos.

## Auditoría

`audit_status` conserva:

```text
NOT_STARTED -> READY -> IN_REVIEW -> APPROVED | REJECTED
REJECTED -> IN_REVIEW (inicio explícito de una revisión posterior)
```

La transición a `READY` ocurre cuando ambas fechas operativas están persistidas e identifica disponibilidad para revisión humana, no suficiencia automática de soportes. El auditor consulta externamente el Drive, decide y registra actor, fecha, observaciones y hallazgos cuando correspondan. `APPROVED` solo puede partir de una revisión humana iniciada. Tras `REJECTED`, solo un auditor puede iniciar explícitamente otra revisión y volver a `IN_REVIEW`.

## Actualización explícita de evidencia F2

Una actualización de las cuatro columnas de origen (`NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`) solo puede comenzar cuando el estado actual es `READY_TO_DISPENSE`. Recalcula la regla previa y persiste `READY_TO_DISPENSE` o `BLOCKED`. No es el mismo contrato que las actualizaciones operativas de ADR-022.

## Prohibiciones

- No persistir `process_summary` como fuente de verdad.
- No crear estados por cada dato operativo cuando pueden derivarse.
- No usar presencia, cantidad o tipo de archivos en Drive para cambiar `audit_status`.
