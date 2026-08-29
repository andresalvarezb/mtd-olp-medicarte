# SPEC-004 — Notificaciones EPS, OLP y Medicarte

**Fase:** 4

## Arquitectura

Negocio -> transacción DB -> outbox -> BullMQ -> worker -> Gmail API.

## Eventos lógicos

- pendiente de direccionamiento para EPS, cuando la regla aprobada lo determine;
- `AUTHORIZATION_READY_TO_DISPENSE`: notifica simultáneamente a OLP y Medicarte que el registro está disponible para coordinación;
- `APPLICATION_SITE_ASSIGNED`: cuando Medicarte define el punto/dirección de aplicación, notifica a OLP la ubicación a la que debe enviar el medicamento.

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

## Secuencia logística

```text
READY_TO_DISPENSE
    -> notificar OLP
    -> notificar MEDICARTE
    -> Medicarte define punto de aplicación
    -> APPLICATION_SITE_ASSIGNED
    -> notificar OLP con la dirección
    -> continúa aplicación / soportes / auditoría
```

### Notificación 1 — disponibilidad

Destinatarios lógicos:

- OLP;
- Medicarte.

Contenido mínimo:

- identificación interna del ítem;
- número de autorización;
- medicamento/código comercial;
- paciente según permisos;
- clasificación PBS/NO_PBS;
- estado `READY_TO_DISPENSE`.

### Notificación 2 — punto de aplicación

Se genera únicamente después de que Medicarte persista una asignación válida.

Destinatario lógico:

- OLP.

Contenido mínimo:

- identificación del ítem;
- número de autorización;
- medicamento;
- punto/dirección de aplicación definido por Medicarte;
- fecha/hora de asignación;
- referencia necesaria para que OLP coordine el envío.

La notificación no puede enviarse antes de comprometer la dirección en PostgreSQL. Debe salir mediante outbox para garantizar consistencia.

## Idempotencia específica

Claves sugeridas:

- disponibilidad OLP: `READY_TO_DISPENSE + authorization_item_id + readiness_version + OLP`;
- disponibilidad Medicarte: `READY_TO_DISPENSE + authorization_item_id + readiness_version + MEDICARTE`;
- dirección a OLP: `APPLICATION_SITE_ASSIGNED + authorization_item_id + application_site_version + OLP`.

Si Medicarte modifica una dirección, aumenta `application_site_version` y se genera una nueva notificación a OLP.
