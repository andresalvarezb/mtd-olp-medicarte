# ADR-006 — Gmail desacoplado mediante outbox
**Estado:** ACCEPTED

## Decisión
Los correos salen por Gmail API desde workers. La transacción de negocio persiste un evento outbox; el envío ocurre después.

## Consecuencia
Un fallo de Gmail no revierte el cambio de negocio. Todo mensaje lógico requiere idempotency key e historial de envío.
