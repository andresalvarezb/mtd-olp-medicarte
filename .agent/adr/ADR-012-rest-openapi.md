# ADR-012 — REST versionado y OpenAPI

**Estado:** ACCEPTED

## Decisión

API REST bajo `/api/v1` con OpenAPI generado y validado en CI. No introducir GraphQL en el MVP.

## Reglas

Errores con código estable y correlation ID. Mutaciones críticas usan `Idempotency-Key`.
