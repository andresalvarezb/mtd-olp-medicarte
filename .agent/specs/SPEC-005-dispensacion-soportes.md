# SPEC-005 — Dispensación, aplicación y soportes externos

**Fases:** 5 y 6

## Flujo operativo

1. MEDICARTE define masivamente `lugar_dispensacion` conforme a SPEC-013.
2. OLP descarga la base completa permitida, realiza el envío y reporta masivamente `fecha_dispensacion`.
3. MEDICARTE realiza la aplicación y reporta masivamente `fecha_aplicacion`.
4. MEDICARTE administra los soportes directamente en el Drive corporativo, fuera de la carga de archivos de la plataforma.
5. El auditor revisa externamente los soportes y registra una decisión humana en la plataforma.

## Datos

- `lugar_dispensacion`: valor vigente definido por MEDICARTE, modificable con historial y notificación a OLP.
- `fecha_dispensacion`: fecha reportada por OLP; su primera carga produce `DISPENSACION_REPORTADA`.
- `fecha_aplicacion`: fecha efectiva de aplicación reportada por MEDICARTE.

Los tres valores vigentes viven en `authorization_items`; `operational_field_changes` conserva cada cambio. Aplican control de versión, idempotencia, permisos backend y auditoría antes/después.

## Soportes

- No existe carga individual de soportes desde la plataforma.
- La aplicación no sube archivos a Drive, no crea `attachments`, no versiona archivos y no exige una relación archivo-ítem.
- La aplicación no cuenta documentos, no exige tipos ni calcula completitud.
- Drive puede conservarse como repositorio corporativo externo/configuración administrativa conforme a ADR-005.
- La decisión de suficiencia documental corresponde exclusivamente al auditor humano.

## Aceptación

- OLP no puede modificar lugar ni fecha de aplicación.
- MEDICARTE no puede modificar fecha de dispensación.
- Cada archivo de actualización contiene solo llave y campo autorizado.
- Fechas y lugar se comparan y exportan sin perder su historial.
- Ningún cambio de soportes en Drive modifica automáticamente `audit_status`.
- No existen endpoints, permisos ni gates de implementación para attachments administrados por la aplicación.
