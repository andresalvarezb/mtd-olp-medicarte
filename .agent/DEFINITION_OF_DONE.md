# Definition of Done

Una tarea no está terminada solo porque compila.

## Obligatorio

- Criterios de aceptación de la SPEC cubiertos.
- Tests relevantes verdes.
- Sin nuevas reglas de negocio no documentadas.
- OpenAPI actualizado si cambia un endpoint.
- Migración incluida si cambia persistencia.
- Auditoría añadida para mutaciones o accesos sensibles definidos.
- Autorización backend validada; ocultar botones no cuenta como seguridad.
- Idempotencia verificada cuando la operación pueda repetirse.
- Errores externos diferenciados de resultados de negocio.
- Logs sin secretos ni datos sensibles innecesarios.
- `pnpm lint`, typecheck y tests verdes.
- Documentación/ADR/SPEC actualizada cuando cambie contrato o decisión.
- Revisión por un agente distinto al implementador para tareas de riesgo medio/alto.

## Evidencia mínima en PR

- Spec/issue relacionada.
- Resumen de cambios.
- Tests ejecutados.
- Migraciones.
- Riesgos/concesiones.
- Capturas solo cuando aporten valor a UI.

## Coordinación logística

- `READY_TO_DISPENSE` genera eventos idempotentes para OLP y Medicarte.
- Solo MEDICARTE puede actualizar masivamente `lugar_dispensacion` y `fecha_aplicacion`.
- Solo OLP puede actualizar masivamente `fecha_dispensacion`.
- Valores vigentes persistidos, historial antes/después y auditoría por fila.
- OLP recibe evento/notificación por cada versión real de `lugar_dispensacion`.
- Las descargas contienen la base completa permitida; las cargas contienen exactamente llave + un campo.
- `application_site_status` se deriva y `support_status` no se persiste.

## Bulk updates

- Archivo máximo 20 MB; fuente temporal en PostgreSQL `BYTEA`; BullMQ recibe solo identificadores.
- Esquema y columna permitida validados en backend por tipo de operación.
- Staging, causales estables, reporte por fila, idempotencia y concurrencia cubiertos.
- Permiso y alcance revalidados por fila y en replays/consultas de lote.
- No existe actualización parcial de campos ajenos mediante columnas extra, alias o manipulación del tipo.

## Soportes y auditoría

- No se implementan endpoints, entidades ni permisos de attachments por registro.
- Ningún conteo/tipo de archivo cambia `audit_status` ni afirma completitud.
- Solo decisión humana autorizada produce `APPROVED`/`REJECTED`, con actor, fecha, observaciones y hallazgos cuando correspondan.
- `audit_status = READY` solo cuando ambas fechas operativas existen; no representa completitud documental.
