# SPEC-004 — Notificaciones operativas y reporte diario

**Fase:** 4 y transversal

## Arquitectura

Negocio -> transacción PostgreSQL (dato + auditoría + outbox) -> BullMQ -> worker -> Gmail API.

## Notificaciones event-driven

| Evento                            | Condición de emisión                          | Destinatario    |
| --------------------------------- | --------------------------------------------- | --------------- |
| `AUTHORIZATION_READY_TO_DISPENSE` | transición comprometida a `LISTO_PARA_DISPENSAR` | OLP y MEDICARTE |
| `DISPENSATION_LOCATION_ASSIGNED`  | primera persistencia de `lugar_dispensacion`  | OLP             |
| `DISPENSATION_LOCATION_CHANGED`   | cambio posterior del valor                    | OLP             |

Estas notificaciones habilitan acciones operativas y se procesan sin esperar al reporte diario. El cambio de lugar solo se publica después de persistir valor vigente, historial y auditoría.

Contenido mínimo de disponibilidad: identificador, número de autorización, código/medicamento, estado y datos adicionales permitidos al destinatario.

Contenido mínimo de lugar: identificador, llave de negocio, `lugar_dispensacion` vigente, versión y fecha/hora del cambio. No incluir valores sensibles que el destinatario no pueda consultar.

## Reporte diario

- Se ejecuta todos los días a las `08:00 America/Bogota`.
- Consolida novedades del día calendario anterior.
- Cada organización recibe únicamente sus novedades.
- No sustituye ni retrasa las notificaciones event-driven.

## Reglas comunes

- Plantillas versionadas y destinatarios por organización/evento parametrizables.
- Altas/bajas de destinatarios protegidas por permiso administrativo y auditadas.
- Persistir destinatarios, asunto, versión de plantilla, parámetros, estado, intentos, fecha y `gmail_message_id`.
- Fallo visible, reintentable y con dead-letter; Gmail caído no revierte el negocio.
- El consumidor tolera entrega al menos una vez.

## Idempotencia

- disponibilidad: `AUTHORIZATION_READY_TO_DISPENSE + item_id + readiness_version + recipient_org`;
- lugar: `event_type + item_id + operational_field_version + OLP`;
- reporte diario: `DAILY_REPORT + recipient_group + local_date + item_set_hash`.

Una modificación real de `lugar_dispensacion` incrementa versión y produce un nuevo correo. Reenviar el mismo evento no lo duplica; un valor idéntico no emite evento.

## Aceptación

- OLP y MEDICARTE reciben eventos independientes al alcanzar `LISTO_PARA_DISPENSAR`.
- OLP recibe el lugar asignado y cada modificación posterior.
- Ningún correo de lugar puede observarse antes del commit.
- El reporte de las 08:00 sigue operando aunque no existan novedades inmediatas y no reemplaza alertas operativas.
