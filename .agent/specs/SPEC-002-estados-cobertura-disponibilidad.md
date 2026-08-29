# SPEC-002 — Estados, cobertura y disponibilidad

**Fases:** 2 y 4

## Dimensiones

- enablement
- coverage
- direction
- operation
- application_site
- support
- audit
- admission

## Reglas confirmadas de cobertura

`normalizar(CUPS_PRINCIPAL)`:

- exactamente `MEDICAMENTOS NO POS` => `NO_PBS`;
- cualquier otro valor => `PBS`.

Normalizar significa trim, mayúsculas y colapso de espacios. No usar contains/regex semántica.

## Reglas confirmadas de habilitación

- `ESTADO_AUTORIZACION == 5` => `ENABLED`;
- otro valor => `BLOCKED_SOURCE_STATUS`.

## Dirección

- PBS => `NOT_APPLICABLE`.
- NO_PBS + ENABLED => entra a MIPRES.
- NO_PBS bloqueado por fuente no consulta MIPRES.

## Disponibilidad y operación

La función `deriveOperationStatus()` debe ser pura y centralizada.

Estados iniciales de `operation_status`:

- `BLOCKED`
- `READY_TO_DISPENSE`
- `DISPENSATION_REPORTED`
- `DISPENSED`

`READY_TO_DISPENSE` significa que el ítem superó las reglas previas de habilitación/cobertura/direccionamiento y entra a coordinación logística. No significa todavía que el medicamento haya sido aplicado.

## Punto de aplicación

Nueva dimensión `application_site_status`:

- `PENDING_ASSIGNMENT`
- `ASSIGNED`

Reglas:

- Cuando un ítem entra en `READY_TO_DISPENSE`, `application_site_status = PENDING_ASSIGNMENT`.
- Medicarte es quien define el punto/dirección donde realizará la aplicación.
- Al guardar la dirección, `application_site_status = ASSIGNED`.
- La asignación debe conservar dirección estructurada, texto de referencia, actor, organización, timestamp e historial de cambios.
- Cambiar una dirección ya asignada debe auditarse y volver a disparar la notificación logística correspondiente a OLP.
- El punto de aplicación no debe guardarse como texto suelto dentro de `authorization_items`; debe modelarse como dato de negocio explícito.

## Continuidad de operación

- Medicarte registra la dispensación/aplicación al cargar los soportes requeridos.
- Ese registro mueve el ítem a `DISPENSATION_REPORTED`.
- `DISPENSED` se deriva únicamente cuando `audit_status = APPROVED`.
- La regla final que marque `READY_TO_DISPENSE` debe quedar congelada por tests antes de Fase 4.

## Prohibición

No persistir `process_summary` como estado autoritativo.
