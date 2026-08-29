# Fases de implementación

La secuencia debe respetar dependencias técnicas y de negocio. Cada fase tiene un **gate de salida**: los agentes no pueden iniciar una fase dependiente hasta que el gate anterior esté satisfecho, salvo trabajo de scaffolding que no fije reglas de negocio pendientes.

### Fase 0 — Cierre de decisiones, contratos y datos

**Objetivo:** eliminar ambigüedades que obligarían a los agentes a inventar reglas.

Entregables obligatorios:

- Decisión del repositorio destino: monorepo independiente o incorporación a repositorios existentes.
- Diccionario de datos definitivo del archivo de autorizaciones, con tipo, obligatoriedad, normalización y validaciones.
- Confirmación de la llave `NUMERO_AUTORIZACION + COD_COMERCIAL`.
- Catálogo estable de causales de carga.
- Llave existente: revisión humana; actualización explícita solo si `operation_status = READY_TO_DISPENSE`, recalcula el estado operacional y queda `BLOCKED` si la nueva clasificación no cumple los prerrequisitos; bloqueada desde `DISPENSATION_REPORTED` en adelante.
- Contrato MIPRES de direccionamientos y credenciales de sandbox. `PENDING` en DEC-013; queda prohibida la implementación real de Fase 3 hasta recibir y validar la evidencia externa.
- Regla de direccionamiento confirmada: `current_date(America/Bogota) < fecha_maxima`; igualdad con la fecha máxima no es válida.
- Reportes diarios a las 08:00 `America/Bogota`, con novedades del día anterior y destinatarios parametrizables.
- Drive parametrizable para cargas futuras; soportes sin borrado automático; máximo 20 MB; exportaciones CSV/XLSX on-demand y no persistentes.
- Auditoría humana/visual; la aprobación explícita del auditor produce `APPROVED` y habilita consolidación.
- Medicarte registra al cargar soportes (`DISPENSATION_REPORTED`); `DISPENSED` ocurre únicamente después de auditoría `APPROVED`.
- Límite inicial de 20 MB y capacidad esperada de hasta 2.500 archivos por mes.
- Render esperado, Google Cloud alternativo, región Colombia.
- Repositorio nuevo e independiente en GitHub, estructurado como monorepo.
- Alcance multi-organización de autorizaciones cerrado en DEC-012, sin duplicar `authorization_items`.

**Gate F0:** las decisiones pendientes que afecten esquema, estados o permisos están documentadas como `ACCEPTED` o explícitamente marcadas como `PENDING` con una prohibición de implementación.

### Fase 1 — Fundación técnica y plataforma ejecutable

**Objetivo:** dejar lista la infraestructura mínima que necesitan las demás fases.

- Monorepo pnpm/Turborepo, TypeScript estricto, Docker y CI.
- Aplicaciones `web`, `api` y `worker`; scheduler como proceso/configuración del backend.
- PostgreSQL + Drizzle + migraciones.
- Redis + BullMQ, incluyendo un job de prueba, reintentos y dead-letter conventions.
- OIDC/Keycloak, `/me`, organizaciones, roles y permisos.
- Esqueleto de auditoría inmutable.
- Patrón outbox transaccional y dispatcher base.
- Convenciones REST `/api/v1`, OpenAPI, errores, correlation ID e idempotencia.
- Observabilidad base: logs JSON, health checks, métricas/trazas y captura de errores.
- Gestión de configuración y secretos por ambiente.

**Gate F1:** CI verde; migración limpia sobre PostgreSQL vacío; login y `/me` operativos; job BullMQ ejecutado extremo a extremo; evento outbox procesado; evento de auditoría persistido; health checks de API/DB/Redis.

### Fase 2 — Ingesta, autorización y clasificación de cobertura

**Objetivo:** completar la primera historia vertical sin depender de MIPRES ni Google Workspace.

- Carga CSV/XLSX y creación de `import_batches`.
- Staging en `import_rows`.
- Normalización y validaciones por campo.
- Detección de duplicados dentro del archivo y contra `authorization_items`.
- Confirmación transaccional y reporte por fila con causal estable.
- Si una llave ya existe, reportarla para verificación humana y permitir actualización explícita solo si `operation_status = READY_TO_DISPENSE`; recalcular `operation_status` en la misma transacción y degradarlo a `BLOCKED` si corresponde.
- `enablement_status` derivado de `ESTADO_AUTORIZACION`: `5 = ENABLED`; cualquier otro valor = `BLOCKED_SOURCE_STATUS`.
- `coverage_type` derivado en esta fase, no en MIPRES:
  - `normalizar(CUPS_PRINCIPAL) == "MEDICAMENTOS NO POS"` → `NO_PBS`.
  - cualquier otro valor → `PBS`.
- Para `PBS`, `direction_status = NOT_APPLICABLE`.
- La confirmación de un ítem nuevo puede dejar `operation_status = NULL` hasta la derivación operacional de Fase 4; una actualización explícita de un ítem ya `READY_TO_DISPENSE` siempre recalcula `READY_TO_DISPENSE` o `BLOCKED`.
- Bandeja de autorizaciones, detalle, filtros y trazabilidad de la carga.
- La bandeja aplica `authorizations.read` y el alcance de `authorization_item_organizations`; MTD conserva lectura global.

**Gate F2:** cargar dos veces el mismo archivo no duplica ítems; dos cargas concurrentes de la misma llave no crean duplicados; cada fila tiene resultado reproducible; PBS/NO PBS se prueba sin llamadas externas.

### Fase 3 — Direccionamientos MIPRES

**Objetivo:** incorporar MIPRES únicamente para los ítems que realmente lo requieren.

- `MipresPort`, `MipresHttpAdapter` y `MipresFakeAdapter`.
- Gestión segura de credenciales.
- Consulta solo para `NO_PBS + ENABLED`.
- Persistencia de `mipres_checks` y del historial de direccionamientos sin sobrescribir evidencia.
- Diferenciación entre `PENDING`, `CONFIRMED` y `QUERY_ERROR`.
- `CONFIRMED` únicamente si `current_date(America/Bogota) < fecha_maxima` del direccionamiento.
- Regla explícita “sin direccionamiento” distinta de “falló la consulta”.
- Revalidación automática de pendientes y revalidación manual con permiso/rate limit.
- Timeout, backoff, circuit breaker, concurrencia configurable y dead-letter.
- Versionamiento de los catálogos **de MIPRES que realmente se utilicen**; la clasificación PBS/NO PBS no depende de esos catálogos.

**Gate F3:** tests de timeout/401/500/respuesta inválida/sin direccionamiento/direccionamiento válido; un reintento no duplica checks ni altera incorrectamente el estado.

### Fase 4 — Disponibilidad y notificaciones

**Objetivo:** convertir estados técnicos en acciones operativas y comunicaciones confiables.

- Regla de derivación de `operation_status` y `READY_TO_DISPENSE`, centralizada en dominio y reutilizada por actualizaciones explícitas.
- Evento de pendiente de direccionamiento para EPS cuando corresponda.
- Evento de disponibilidad para OLP cuando corresponda.
- Plantillas versionadas y destinatarios configurables.
- Handlers de outbox para Gmail.
- Consolidación diaria a las 08:00 de novedades del día calendario anterior (`America/Bogota`), destinatarios parametrizables, deduplicación, idempotency keys y bandeja administrativa de fallos.
- Historial de notificaciones y `gmail_message_id`.

El patrón outbox **no nace en esta fase**; debe existir desde Fase 1. Aquí se implementan los eventos y handlers específicos del negocio.

**Gate F4:** repetir el mismo evento no duplica correo; una caída de Gmail no revierte el estado de negocio; un fallo queda visible y reintentable.

### Fase 5 — Dispensación y soportes

**Objetivo:** habilitar la operación de Medicarte y el manejo documental sin perder versiones.

- Bandeja de disponibles según permisos.
- Precondición: `application_site_status = ASSIGNED`.
- Medicarte registra la dispensación cuando carga los soportes requeridos.
- El registro produce `DISPENSATION_REPORTED`.
- `DISPENSED` solo se produce posteriormente cuando auditoría = `APPROVED`.
- Tipos de soporte: fórmula y soporte de aplicación.
- Google Drive Shared Drive mediante adaptador, con ID destino parametrizable por MTD Admin para cargas futuras.
- Metadatos en PostgreSQL, hash SHA-256, versiones, reemplazos y versión vigente.
- Validación MIME real, máximo 20 MB por archivo y antivirus.
- Descarga siempre mediada por API y autorización.
- Corrección/reemplazo sin eliminar evidencia anterior.
- Notificaciones de faltantes si la regla de negocio lo exige.

**Gate F5:** no hay enlaces públicos; reemplazar soporte conserva historial; fallo Drive/DB deja una situación conciliable; acceso cruzado entre empresas es rechazado.

### Fase 6 — Auditoría, consolidación y preparación de admisión

**Objetivo:** cerrar el ciclo operativo interno.

- Bandeja de auditoría MTD/Facturación.
- Inicio de revisión, hallazgos, rechazo, subsanación y aprobación.
- Validación de soportes requeridos antes de aprobar.
- Exportaciones CSV/XLSX bajo demanda con filtros y permisos, sin conservar copia persistente; auditar la operación.
- Indicadores operativos.
- Solo registros con `audit_status = APPROVED` pueden entrar al consolidado.
- Derivación de `admission_status = READY`/`READY_FOR_ADMISSION` únicamente desde reglas de dominio; nunca por edición libre de UI.

**Gate F6:** un auditor no puede aprobar un ítem inválido según los criterios aprobados; exportaciones no bloquean la API; todas las lecturas/descargas sensibles definidas quedan auditadas.

### Fase 7 — Handoff al scraper de admisiones

**Objetivo:** integrar el proceso externo sin acoplarlo al núcleo.

- Contrato versionado de API/cola de `READY_FOR_ADMISSION`.
- `admission_jobs` y estados independientes.
- Claim/lease con expiración para evitar doble procesamiento.
- Idempotencia de creación de admisión.
- Resultado, reintentos, errores y conciliación.
- El scraper mantiene sus propios estados internos y reporta el resultado al núcleo.

**Gate F7:** consumir dos veces el mismo trabajo no crea dos admisiones; un lease abandonado puede recuperarse; los fallos del scraper no alteran la aprobación ya registrada.

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
 ↓
F7
```

Dentro de una fase se permite paralelizar frontend, backend, pruebas e infraestructura solo cuando existe un contrato compartido aprobado. No se permite que distintos agentes creen DTO, enums o reglas equivalentes de forma independiente.

### Estimación de planificación

La estimación original de **12 a 16 semanas** para una sola persona sigue siendo razonable como orden de magnitud mientras existan integraciones reales, seguridad, QA y decisiones de negocio pendientes. El uso de agentes de IA puede reducir trabajo mecánico y permitir paralelismo, pero no elimina los gates de integración, revisión, pruebas ni las decisiones que requieren validación humana.

## Regla transversal de exportación

CSV/XLSX se generan bajo demanda y no se conserva una copia persistente. Solo se conserva la auditoría de la operación.

## Cierre de Fase 0

El resultado verificable se documenta en `F0_CLOSURE.md`. DEC-001 a DEC-012 están `ACCEPTED`. DEC-013 permanece `PENDING` con prohibición explícita de implementar la integración MIPRES real; por ello el gate permite Fases 1 y 2, pero bloquea Fase 3 y cualquier trabajo posterior que infiera el contrato externo.
