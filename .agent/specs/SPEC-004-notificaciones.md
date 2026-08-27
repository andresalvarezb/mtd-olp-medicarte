# SPEC-004 — Notificaciones EPS y OLP
**Fase:** 4

## Arquitectura
Negocio -> transacción DB -> outbox -> BullMQ -> worker -> Gmail API.

## Eventos lógicos
- pendiente de direccionamiento para EPS, cuando la regla aprobada lo determine;
- disponibilidad para OLP, cuando la regla aprobada lo determine.

## Reglas
- plantillas versionadas;
- destinatarios por organización/evento;
- ejecución diaria;
- cada ejecución consolida las novedades del día calendario anterior usando `America/Bogota`;
- cada entidad recibe únicamente su reporte correspondiente;
- ejecución a las `08:00 America/Bogota`;
- destinatarios parametrizables, no codificados;
- altas/bajas de destinatarios auditadas y protegidas por permiso administrativo;
- consolidación por ventana diaria;
- idempotency key estable;
- guardar destinatarios, asunto, versión de plantilla, parámetros, estado, fecha y Gmail message id;
- fallo visible/reintentable.

## Aceptación
Reprocesar evento no duplica correo. Gmail caído no revierte estado de negocio.
