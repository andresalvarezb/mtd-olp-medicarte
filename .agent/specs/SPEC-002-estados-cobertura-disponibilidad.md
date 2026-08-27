# SPEC-002 — Estados, cobertura y disponibilidad
**Fases:** 2 y 4

## Dimensiones
- enablement
- coverage
- direction
- operation
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

Reglas confirmadas:
- Medicarte registra la dispensación al cargar los soportes requeridos.
- Ese registro mueve el ítem a `DISPENSATION_REPORTED`.
- `DISPENSED` se deriva únicamente cuando `audit_status = APPROVED`.
- La regla final que marque `READY_TO_DISPENSE` debe quedar congelada por tests antes de Fase 4.

## Prohibición
No persistir `process_summary` como estado autoritativo.
