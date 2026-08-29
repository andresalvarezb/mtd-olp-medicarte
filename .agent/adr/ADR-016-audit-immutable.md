# ADR-016 — Auditoría inmutable, no event sourcing

**Estado:** ACCEPTED

## Decisión

`audit_events` es append-only desde la aplicación y complementa las tablas de negocio. No reconstruye el estado completo ni convierte el sistema en event-sourced.

## Consecuencias

Mutaciones y accesos sensibles definidos deben producir evidencia con actor, organización, acción, recurso, timestamps y correlation ID.

Para una actualización explícita F2, el evento referencia las filas de importación anterior y nueva, conserva hashes de su evidencia, compara `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `CUPS_PRINCIPAL` y `ESTADO_AUTORIZACION` normalizados antes/después, y enlaza el registro idempotente de la misma transacción. La evidencia cruda permanece en las tablas de negocio y no se duplica en auditoría ni en la respuesta idempotente persistida.
