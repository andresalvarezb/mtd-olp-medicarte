# CE-26 a CE-32 — Auditorías de atención, integridad y conciliación

**Fuentes:** controladores de `apps/api/src/audits/` y `apps/api/src/reconciliation/`, contratos y [ADR-042](../adr/042-reconciliation-operations-and-alerts.md). No confundir proceso clínico de atención, evaluación para facturación, historial de cambios y hallazgos de integridad.

## CE-26 — Auditoría de una aplicación

`GET /api/v1/application-audits`, `GET .../:id`, `POST /api/v1/applications/:applicationId/audit/start`, `POST /api/v1/application-audits/:id/approve` o `/reject`. Permisos `application_audits.read`/`application_audits.manage`. Estados del contrato: `READY_FOR_AUDIT`, `IN_REVIEW`, `APPROVED`, `REJECTED`.

Para **aprobar**: `expectedVersion` positivo y `evidenceReference` opcional. Para **rechazar**: `expectedVersion`, `rejectionCode` y opcionalmente observación/referencia. Causales definidas: `APPLICATION_DATA_INCONSISTENT`, `AUTHORIZATION_INCONSISTENT`, `QUANTITY_INCONSISTENT`, `PRODUCT_INCONSISTENT`, `SUPPORT_MISSING`, `OTHER`; para `OTHER` la observación es obligatoria. La versión es control de concurrencia: descargar detalle actualizado ante conflicto, no forzar incremento manual.

## CE-27 — Auditoría de fulfillment (entrega o aplicación)

`GET /api/v1/fulfillment-audits` y `GET .../:id`; abrir con `POST /api/v1/fulfillments/:fulfillmentId/audit/start`; aprobar/rechazar mediante `POST /api/v1/fulfillment-audits/:id/approve` o `/reject`. Se exige `application_audits.manage` para gestionar. El rechazo requiere `observation` conforme al contrato. Cada evento auditado tiene identidad propia: **una auditoría de fulfillment no reemplaza una auditoría de facturación por AUTO**.

## CE-28 — Historial y eventos técnicos

El historial de autorización se consulta desde `GET /api/v1/authorization-query/:id/history`; las ediciones generan `audit_events` con actor, recurso, before/after y correlación. Los eventos de auditoría técnica deben ser inmutables/trazables; una modificación de AUTO no debe borrar confirmaciones de atención, movimientos, revisiones de programación ni OC históricas. Validar contra la BD y políticas reales de retención.

## CE-29 — Ejecutar conciliación de integridad

`POST /api/v1/reconciliation/runs` inicia proceso; `GET /api/v1/reconciliation/runs`, `GET .../runs/:id`, `GET .../runs/:id/findings` consultan ejecución y hallazgos. `GET /api/v1/reconciliation/rules` permite inspeccionar reglas. El controlador exige **MTD** y permisos específicos `reconciliation.run` o `reconciliation.read`. Un hallazgo es evidencia para análisis, **no una orden de modificar automáticamente cantidades**.

## CE-30 — Triaging de incidencias

Endpoints bajo `/api/v1/reconciliation/issues`: listado/detalle, comentarios, `acknowledge`, `assign`, `unassign`, `resolve` y los que registre el controlador vigente. Su operación está protegida por `reconciliation_issues.read`, `triage` o `comment` según la acción y solicitudes con versión. Registrar responsable, justificación, estado y resolución; preservar historial de la incidencia.

## CE-31 — Operaciones de reconciliación gobernadas

`/api/v1/reconciliation/operations/policy/enable` y `/disable` cambian la política con permiso `reconciliation_operations.manage`; ejecución y consulta operativa tienen permisos diferenciados. El scheduler de reconciliación se controla por `RECONCILIATION_SCHEDULER_ENABLED` (por defecto `false`) y exige pruebas de permisos, política y efectos reales antes de habilitarlo fuera de pruebas. No asumir que reconciliación activa equivale a autocorrección de inventario.

## CE-32 — Notificaciones y alertas

`GET /api/v1/reconciliation/notifications`, `POST .../notifications/:id/read`, `POST .../notifications/read-all` permiten control de lectura con permiso `reconciliation_notifications.read`; el marcado leído no resuelve la causa. La UI de alertas y operaciones debe concordar con el estado de hallazgos real.

## Preguntas de control para cada auditoría

- ¿Qué hecho exacto se audita: aplicación, fulfillment o AUTO facturable?
- ¿Existe fecha y cantidad de atención real, no solo reserva?
- ¿Cuál es la versión de lectura al registrar la decisión?
- ¿Qué soporte/documento y autor respaldan el dictamen?
- ¿Es una decisión definitiva, un hallazgo de reconciliación o una notificación?
- ¿La intervención exige validación humana, un permiso especial o foundation admin?

**Pendiente:** comparación con todos los servicios de dominio, matrices RBAC completas, resultados de integración y flujos de devolución/corrección que puedan requerir reglas de negocio adicionales.
