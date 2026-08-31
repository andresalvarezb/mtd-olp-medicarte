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
- Los estados de negocio y procesamiento deben coincidir con el catálogo en `docs/architecture/estados-backend.md`.
- Revisión por un agente distinto al implementador para tareas de riesgo medio/alto.

## Evidencia mínima en PR

- Spec/issue relacionada.
- Resumen de cambios.
- Tests ejecutados.
- Migraciones.
- Riesgos/concesiones.
- Capturas solo cuando aporten valor a UI.

## Coordinación logística

- `LISTO_PARA_DISPENSAR` genera eventos idempotentes para OLP y Medicarte.
- Solo MEDICARTE puede actualizar masivamente `lugar_dispensacion` y `fecha_aplicacion`.
- Solo OLP puede actualizar masivamente `fecha_dispensacion`.
- Valores vigentes persistidos, historial antes/después y auditoría por fila.
- OLP recibe evento/notificación por cada versión real de `lugar_dispensacion`.
- Las descargas contienen la base completa permitida, incluyendo `CDGN001` después de `NOMBRE_PACIENTE` y excluyendo `CPRG`; la carga de aplicación contiene exactamente `authorization_key,fecha_aplicacion_medicamento` y las demás cargas contienen llave + un campo.
- `application_site_status` se deriva y `support_status` no se persiste.

## Bulk updates

- Archivo máximo 20 MB; fuente temporal en PostgreSQL `BYTEA`; BullMQ recibe solo identificadores.
- Esquema y columna permitida validados en backend por tipo de operación.
- Staging, causales estables, reporte por fila, idempotencia y concurrencia cubiertos.
- Permiso y alcance revalidados por fila y en replays/consultas de lote.
- No existe actualización parcial de campos ajenos mediante columnas extra, alias o manipulación del tipo.

## Reversión de cargues

- La selección de ítems proviene exclusivamente de `created_from_batch_id`; ningún criterio indirecto (fecha, usuario, llave) participa.
- Preview de impacto obligatorio antes de ejecutar; sin confirmaciones genéricas.
- Los ítems con actividad posterior quedan bloqueados con causal estable y son visibles en el resultado.
- `import_batch` nunca se elimina; la reversión y sus contadores quedan auditados con correlation ID.
- La auditoría y la evidencia por fila sobreviven al borrado de los ítems.
- Segunda ejecución idempotente: sin nuevos efectos, sin auditorías duplicadas.

## Soportes y auditoría

- No se implementan endpoints, entidades ni permisos de attachments por registro.
- Ningún conteo/tipo de archivo cambia `audit_status` ni afirma completitud.
- Solo decisión humana autorizada produce `APROBADO`/`RECHAZADO`, con actor, fecha, observaciones y hallazgos cuando correspondan.
- `audit_status = LISTO` solo cuando ambas fechas operativas existen; no representa completitud documental.
