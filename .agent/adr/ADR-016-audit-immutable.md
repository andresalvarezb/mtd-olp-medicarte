# ADR-016 — Auditoría inmutable, no event sourcing
**Estado:** ACCEPTED

## Decisión
`audit_events` es append-only desde la aplicación y complementa las tablas de negocio. No reconstruye el estado completo ni convierte el sistema en event-sourced.

## Consecuencias
Mutaciones y accesos sensibles definidos deben producir evidencia con actor, organización, acción, recurso, timestamps y correlation ID.
