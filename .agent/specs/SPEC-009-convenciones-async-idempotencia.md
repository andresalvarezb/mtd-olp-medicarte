# SPEC-009 — Jobs, outbox e idempotencia

**Fase:** 1 y transversal

## Contrato de job

Todo job define:

- nombre/version;
- payload validado;
- correlation ID;
- idempotency key;
- número máximo de intentos;
- backoff;
- clasificación de errores retryable/non-retryable;
- resultado persistente;
- dead-letter behavior.

## Outbox

Se escribe en la misma transacción del cambio de negocio. El dispatcher puede entregar más de una vez; el consumidor debe tolerarlo.

## Claves base

- import: `batch + file_hash + processor_version`;
- MIPRES: `item + query_type + time_window`;
- email: `notification_type + recipient_group + period + item_set_hash`;
- attachment: `item + support_type + file_hash`;
- admission: `item + contract_version`.

## Aceptación

Ejecución duplicada produce un único efecto lógico.

## Exportaciones bajo demanda

Las exportaciones no son un artefacto persistente de background. CSV/XLSX se generan a solicitud del usuario y se entregan sin conservar una copia permanente.

Si se usa almacenamiento temporal, debe ser efímero y limpiarse al terminar o fallar la operación. Sí debe persistirse el evento de auditoría de exportación.

## Eventos logísticos

Los siguientes eventos deben producirse vía outbox transaccional:

- `AUTHORIZATION_READY_TO_DISPENSE`
- `APPLICATION_SITE_ASSIGNED`
- `APPLICATION_SITE_CHANGED`

`APPLICATION_SITE_ASSIGNED` y `APPLICATION_SITE_CHANGED` solo pueden publicarse después de persistir correctamente la versión de la dirección.
