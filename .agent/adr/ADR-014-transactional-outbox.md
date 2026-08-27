# ADR-014 — Outbox transaccional desde la fundación
**Estado:** ACCEPTED

## Decisión
Toda mutación que deba producir un efecto asíncrono externo guarda en la misma transacción:
1. cambio de negocio;
2. auditoría;
3. `outbox_event`.

El dispatcher procesa el outbox de forma idempotente.

## Razón
No esperar hasta la fase de correo: MIPRES, notificaciones y handoffs comparten la misma necesidad de confiabilidad.
