# ADR-004 — Procesamiento asíncrono con BullMQ

**Estado:** ACCEPTED

## Decisión

Importaciones y actualizaciones masivas, MIPRES, correo y reintentos se ejecutan mediante worker y BullMQ/Redis. Las exportaciones normales se generan on-demand conforme a ADR-018 y no requieren un job persistente.

## Consecuencias

Todo job debe ser idempotente, tener política de retry/backoff y terminar en una bandeja de fallo operable cuando agote reintentos.
