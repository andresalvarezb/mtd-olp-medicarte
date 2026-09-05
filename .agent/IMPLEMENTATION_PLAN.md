# Fases de implementación

La secuencia debe respetar dependencias técnicas y de negocio. Cada fase tiene un **gate de salida**: los agentes no pueden iniciar una fase dependiente hasta que el gate anterior esté satisfecho, salvo trabajo de scaffolding que no fije reglas de negocio pendientes.

### Fase 0 — Cierre de decisiones, contratos y datos

**Objetivo:** eliminar ambigüedades que obligarían a los agentes a inventar reglas.

Entregables obligatorios:

- Decisión del repositorio destino: monorepo independiente o incorporación a repositorios existentes.
- Diccionario de datos definitivo del archivo de autorizaciones, con tipo, obligatoriedad, normalización y validaciones; versión 2 con `No.PRESCRIPCION` (DEC-016).
- Confirmación de la llave `NUMERO_AUTORIZACION + COD_COMERCIAL`.
- Catálogo estable de causales de carga.
- Llave existente: revisión humana; actualización explícita solo si `operation_status = READY_TO_DISPENSE`, recalcula el estado operacional y queda `BLOCKED` si la nueva clasificación no cumple los prerrequisitos; bloqueada desde `DISPENSATION_REPORTED` en adelante.
- Contrato MIPRES de direccionamientos aceptado en DEC-013: integración de lectura `WSSUMMIPRESNOPBS` con `GenerarToken`, `DireccionamientoXPrescripcion` y `MipresTokenProvider`, según `contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`. `noPrescripcion` proviene de `No.PRESCRIPCION` sin sus últimos 3 dígitos (DEC-016).
- Regla de direccionamiento confirmada: `current_date(America/Bogota) < fecha_maxima`; igualdad con la fecha máxima no es válida.
- No se implementan notificaciones automáticas, reporte diario ni destinatarios configurables para este flujo.
- Drive conservado como repositorio corporativo externo; Medicarte administra allí los soportes sin carga individual desde la aplicación; exportaciones XLSX on-demand y no persistentes.
- Auditoría humana/visual sin cálculo automático de completitud; la aprobación explícita produce `APPROVED` y habilita consolidación.
- OLP reporta masivamente `fecha_dispensacion` (`DISPENSATION_REPORTED`); Medicarte reporta `fecha_aplicacion`; `DISPENSED` ocurre únicamente después de auditoría `APPROVED`.
- Pipeline genérico de bulk updates cerrado por tipo, llave + un campo, 20 MB, fuente temporal PostgreSQL `BYTEA`, BullMQ con identificadores, staging y reporte por fila.
- Límite de 20 MB para importaciones y actualizaciones masivas; se retira el dimensionamiento mensual de soportes externos.
- Render esperado, Google Cloud alternativo, región de producción aprobada: Virginia (USA).
- Repositorio nuevo e independiente en GitHub, estructurado como monorepo.
- Alcance multi-organización de autorizaciones cerrado en DEC-012, sin duplicar `authorization_items`.
- Ambas fechas operativas habilitan `audit_status = READY`; la suficiencia documental y aprobación siguen siendo humanas.

**Gate F0:** las decisiones pendientes que afecten esquema, estados o permisos están documentadas como `ACCEPTED` o explícitamente marcadas como `PENDING` con una prohibición de implementación.

### Fase 1 — Fundación técnica y plataforma ejecutable

**Objetivo:** dejar lista la infraestructura mínima que necesitan las demás fases.

- Monorepo pnpm/Turborepo, TypeScript estricto, Docker y CI.
- Aplicaciones `web`, `api` y `worker`; scheduler como proceso/configuración del backend.
- PostgreSQL + Drizzle + migraciones.
- Redis + BullMQ, incluyendo un job de prueba, reintentos y dead-letter conventions.
- Autenticación local (usuarios PostgreSQL + JWT propio, ADR-026), `/me`, organizaciones, roles y permisos.
- Esqueleto de auditoría inmutable.
- Patrón outbox transaccional y dispatcher base.
- Convenciones REST `/api/v1`, OpenAPI, errores, correlation ID e idempotencia.
- Observabilidad base: logs JSON, health checks, métricas/trazas y captura de errores.
- Gestión de configuración y secretos por ambiente.

**Gate F1:** CI verde; migración limpia sobre PostgreSQL vacío; login y `/me` operativos; job BullMQ ejecutado extremo a extremo; evento outbox procesado; evento de auditoría persistido; health checks de API/DB/Redis.

### Fase 2 — Ingesta, autorización y clasificación de cobertura

**Objetivo:** completar la primera historia vertical sin depender de MIPRES ni Google Workspace.

- Carga XLSX (`.xlsx`) y creación de `import_batches`.
- Staging en `import_rows`.
- Normalización y validaciones por campo.
- Detección de duplicados dentro del archivo y contra `authorization_items`.
- Confirmación transaccional y reporte por fila con causal estable.
- Si una llave ya existe, reportarla para verificación humana y permitir actualización explícita solo si `operation_status = READY_TO_DISPENSE`; recalcular `operation_status` en la misma transacción y degradarlo a `BLOCKED` si corresponde.
- `enablement_status` derivado de `ESTADO_AUTORIZACION`: `5 = ENABLED`; cualquier otro valor = `BLOCKED_SOURCE_STATUS`.
- `coverage_type` derivado en esta fase, no en MIPRES:
  - `normalizar(No.PRESCRIPCION)` vacío → `PBS` (valor no vacío → `NO_PBS`), conforme a DEC-016.
  - `No.PRESCRIPCION` no vacío debe contener solo dígitos con longitud mayor a 3; en caso contrario la fila se rechaza.
  - `no_prescripcion` para MIPRES se deriva retirando los últimos 3 dígitos; se conserva el valor original como evidencia.
  - `CUPS_PRINCIPAL` pasa a evidencia sin semántica de negocio.
- Para `PBS`, `direction_status = NOT_APPLICABLE`.
- La confirmación de un ítem nuevo puede dejar `operation_status = NULL` hasta la derivación operacional de Fase 4; una actualización explícita de un ítem ya `READY_TO_DISPENSE` siempre recalcula `READY_TO_DISPENSE` o `BLOCKED`.
- Bandeja de autorizaciones, detalle, filtros y trazabilidad de la carga.
- La bandeja aplica `authorizations.read` y el alcance de `authorization_item_organizations`; MTD conserva lectura global.

**Gate F2:** cargar dos veces el mismo archivo no duplica ítems; dos cargas concurrentes de la misma llave no crean duplicados; cada fila tiene resultado reproducible; PBS/NO PBS se prueba sin llamadas externas.

### Fase 3 — Direccionamientos MIPRES

**Objetivo:** incorporar MIPRES únicamente para los ítems que realmente lo requieren. El alcance es exclusivamente de lectura conforme a DEC-013 y `contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`.

- `MipresPort`, `MipresHttpAdapter` y `MipresFakeAdapter`.
- `MipresTokenProvider`: `GET GenerarToken` con `MIPRES_NIT`/`MIPRES_INITIAL_TOKEN`; token operativo en backend, renovable, sin exponerlo ni registrarlo completo.
- Consulta `GET DireccionamientoXPrescripcion` solo para `NO_PBS + ENABLED`, usando `no_prescripcion` derivado de `No.PRESCRIPCION` sin sus últimos 3 dígitos (DEC-016).
- Normalización de `ID`, `IDDireccionamiento`, `NoPrescripcion`, `TipoTec`, `ConTec`, `FecMaxEnt`, `EstDireccionamiento`, `FecAnulacion` a `MipresDirection`; los nombres oficiales no salen del adaptador.
- Gestión segura de credenciales; `MIPRES_BASE_URL` configurable, nunca hardcodeada.
- Persistencia de `mipres_checks` y del historial de direccionamientos sin sobrescribir evidencia; tokens redactados/eliminados antes de persistir.
- Diferenciación entre `PENDING`, `CONFIRMED` y `QUERY_ERROR`.
- `CONFIRMED` únicamente si existe direccionamiento no anulado con `current_date(America/Bogota) < FecMaxEnt`.
- Regla explícita “sin direccionamiento” y “anulado” distintas de “falló la consulta”.
- Revalidación automática de pendientes y revalidación manual con permiso/rate limit.
- Timeout, backoff, circuit breaker, concurrencia configurable y dead-letter.
- Versionamiento de los catálogos **de MIPRES que realmente se utilicen**; la clasificación PBS/NO PBS no depende de esos catálogos.

**Gate F3:** tests de timeout/401/500/respuesta inválida/sin direccionamiento/direccionamiento anulado/direccionamiento vigente/igualdad de `FecMaxEnt`; un reintento no duplica checks ni altera incorrectamente el estado; la evidencia no contiene tokens.

### Fase 4 — Disponibilidad operativa

**Objetivo:** convertir estados técnicos en acciones operativas y comunicaciones confiables.

- Regla de derivación de `operation_status` y `READY_TO_DISPENSE`, centralizada en dominio y reutilizada por actualizaciones explícitas.
- Estados de disponibilidad para OLP y MEDICARTE, sin envío de notificaciones.
- Descarga on-demand de base completa permitida para MEDICARTE.
- Pipeline reutilizable de bulk updates: lote, fuente `BYTEA`, staging, resultados y consulta.
- Operación MEDICARTE para `lugar_dispensacion`, con esquema exacto de llave + campo.
- Persistencia del valor vigente en `authorization_items`, historial append-only y estado de sitio derivado.
- Eventos `DISPENSATION_LOCATION_ASSIGNED` y `DISPENSATION_LOCATION_CHANGED` para OLP.
- No se crean plantillas de correo, handlers Gmail ni historial de notificaciones.

El patrón outbox **no nace en esta fase**; debe existir desde Fase 1. Aquí se implementan los eventos y handlers específicos del negocio.

**Gate F4:** repetir evento/lote no duplica correo ni cambio; columnas extra o actor incorrecto son rechazados en backend; una caída de Gmail no revierte el estado; OLP recibe cada versión real del lugar y los fallos quedan visibles/reintentables.

### Fase 5 — Dispensación y aplicación masivas

**Objetivo:** habilitar la operación masiva de OLP y MEDICARTE con trazabilidad, manteniendo soportes fuera de la aplicación.

- Descargas de base completa según permisos; OLP recibe `lugar_dispensacion`.
- OLP carga únicamente llave + `fecha_dispensacion`; primera fecha produce `DISPENSATION_REPORTED`.
- MEDICARTE carga únicamente llave + `fecha_aplicacion`.
- Reutilización del pipeline de F4 y reporte de procesadas/actualizadas/sin cambio/rechazadas.
- Correcciones conservan antes/después, actor, lote, fila, organización y versión.
- `DISPENSED` solo se produce posteriormente cuando auditoría humana = `APPROVED`.
- Los soportes son administrados directamente por MEDICARTE en Drive; no hay attachments, carga, descarga, versionado, MIME, antivirus o conteo de documentos en la aplicación.

**Gate F5:** cada actor solo modifica su campo; descargas respetan sensibilidad; concurrencia/reintentos no pierden historial; acceso cruzado y columnas extra son rechazados; no existe flujo individual de soportes.

### Fase 6 — Auditoría, consolidación y preparación de admisión

**Objetivo:** cerrar el ciclo operativo interno.

- Bandeja de auditoría MTD/Facturación.
- Inicio de revisión, hallazgos, rechazo, subsanación y aprobación.
- Revisión manual externa de soportes; la plataforma no calcula completitud.
- Derivación `NOT_STARTED -> READY` cuando existen ambas fechas operativas, sin inferir suficiencia documental.
- Exportaciones XLSX bajo demanda con filtros y permisos, sin conservar copia persistente; auditar la operación.
- Indicadores operativos.
- El consolidado refleja el estado actual de todos los registros.
- Derivación de `admission_status = READY` únicamente desde reglas de dominio; nunca por edición libre de UI.

**Gate F6:** ambas fechas habilitan revisión; solo un auditor puede decidir y ningún proceso automático aprueba; actor, fecha, observaciones y hallazgos quedan trazables; exportaciones no bloquean la API y lecturas/descargas sensibles quedan auditadas.

### Fase 6 — límite del alcance de la plataforma

Fase 6 cierra el alcance funcional de la aplicación. La plataforma deriva `admission_status = READY` ("listo para admisión") para registros con `audit_status = APPROVED`; el proceso de admisión comienza cuando MTD descarga la base de esos registros y continúa fuera de este aplicativo. No existe handoff, cola, contrato de entrega ni estados posteriores (`HANDED_OFF`, `COMPLETED`, `ERROR`); toda integración con admisiones es responsabilidad de un proceso externo.

### Orden obligatorio de dependencias

```text
F0
 ↓
F1
 ↓
F2
 ↓
F3
 ↓
F4
 ↓
F5
 ↓
F6
```

Dentro de una fase se permite paralelizar frontend, backend, pruebas e infraestructura solo cuando existe un contrato compartido aprobado. No se permite que distintos agentes creen DTO, enums o reglas equivalentes de forma independiente.

### Estimación de planificación

La estimación original de **12 a 16 semanas** para una sola persona sigue siendo razonable como orden de magnitud mientras existan integraciones reales, seguridad, QA y decisiones de negocio pendientes. El uso de agentes de IA puede reducir trabajo mecánico y permitir paralelismo, pero no elimina los gates de integración, revisión, pruebas ni las decisiones que requieren validación humana.

## Regla transversal de exportación

XLSX se genera bajo demanda y no se conserva una copia persistente. Solo se conserva la auditoría de la operación.

## Cierre de Fase 0

El resultado verificable se documenta en `F0_CLOSURE.md`. No quedan decisiones `PENDING`: DEC-013 se cerró con el contrato de lectura `WSSUMMIPRESNOPBS` y autoriza el alcance de Fase 3 definido en el contrato y SPEC-003.
