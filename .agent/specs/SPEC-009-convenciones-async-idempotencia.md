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
- bulk update: `operation_type + organization + file_hash + contract_version`;
- admission: `item + contract_version`.

## Aceptación

Ejecución duplicada produce un único efecto lógico.

Un replay HTTP siempre revalida la autenticación, el permiso y el alcance organizacional vigentes antes de devolver la respuesta persistida. Los campos sensibles se redactan según los permisos actuales, aunque la ejecución original hubiera autorizado su lectura.

## Exportaciones bajo demanda

Las exportaciones no son un artefacto persistente de background. CSV/XLSX se generan a solicitud del usuario y se entregan sin conservar una copia permanente.

Si se usa almacenamiento temporal, debe ser efímero y limpiarse al terminar o fallar la operación. Sí debe persistirse el evento de auditoría de exportación.

## Eventos logísticos

Los siguientes eventos deben producirse vía outbox transaccional:

- `AUTHORIZATION_READY_TO_DISPENSE`
- `DISPENSATION_LOCATION_ASSIGNED`
- `DISPENSATION_LOCATION_CHANGED`

Los eventos de lugar solo pueden publicarse en la misma transacción que persiste correctamente valor vigente, versión, historial y auditoría.

## Archivos fuente de bulk update

El máximo es 20 MB. El API guarda el archivo temporal en una tabla PostgreSQL separada con `BYTEA`; BullMQ recibe solo identificadores. El worker recupera la fuente, crea staging por fila y publica resultados persistentes. El archivo binario se nulifica al finalizar, con la misma política de las importaciones F2; nunca viaja en el payload Redis.
