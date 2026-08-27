# ADR-004 — Procesamiento asíncrono con BullMQ
**Estado:** ACCEPTED

## Decisión
Importaciones pesadas, MIPRES, correo, archivos, exportaciones y reintentos se ejecutan mediante worker y BullMQ/Redis.

## Consecuencias
Todo job debe ser idempotente, tener política de retry/backoff y terminar en una bandeja de fallo operable cuando agote reintentos.
