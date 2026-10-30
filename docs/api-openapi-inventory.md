# Inventario HTTP generado desde OpenAPI

**Checkout fuente:** `feat/moderator-fee-sheets-config-local` @ `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30`.
**Fecha:** 2026-10-30.
**Fuente:** `GET /api/v1/openapi.json` del API activo en el entorno aislado de integración.
**Cobertura:** 187 rutas y 211 operaciones HTTP.

Este archivo enumera métodos y rutas declarados por Swagger. No describe permisos, cuerpos, respuestas ni disponibilidad en despliegue. El prefijo `/api/v1` está incluido.

## Rutas por dominio

### access-scopes

- `GET /api/v1/access-scopes/assignable-points`
- `GET /api/v1/access-scopes/users/{userId}/points`
- `PUT /api/v1/access-scopes/users/{userId}/points`

### admin

- `GET /api/v1/admin/dead-letter-jobs`
- `GET /api/v1/admin/product-delivery-points`
- `POST /api/v1/admin/product-delivery-points/import`
- `POST /api/v1/admin/purchase-orders/reconcile-received-allocations`
- `POST /api/v1/admin/tariff-annex/imports`
- `GET /api/v1/admin/tariff-annex/imports/{importId}`
- `POST /api/v1/admin/tariff-annex/imports/{importId}/confirm`
- `POST /api/v1/admin/tariff-annex/imports/{importId}/prepare`
- `GET /api/v1/admin/tariff-annex/products`

### analytics

- `GET /api/v1/analytics/dashboard`
- `GET /api/v1/analytics/dashboard/financial-audit`
- `GET /api/v1/analytics/drilldown`
- `GET /api/v1/analytics/economics`
- `GET /api/v1/analytics/export.xlsx`
- `GET /api/v1/analytics/inventory`
- `GET /api/v1/analytics/novelties`
- `GET /api/v1/analytics/operational`

### application-audits

- `GET /api/v1/application-audits`
- `GET /api/v1/application-audits/{id}`
- `POST /api/v1/application-audits/{id}/approve`
- `POST /api/v1/application-audits/{id}/reject`

### applications

- `POST /api/v1/applications/{applicationId}/audit/start`

### auth

- `POST /api/v1/auth/change-password`
- `POST /api/v1/auth/login`

### authorization-billing-audits

- `POST /api/v1/authorization-billing-audits/{auditId}/decision`
- `GET /api/v1/authorization-billing-audits/{auditId}/evidence/{evidenceId}/content`
- `POST /api/v1/authorization-billing-audits/{auditId}/evidence/drive/search`
- `GET /api/v1/authorization-billing-audits/authorization/{authorizationItemId}`
- `POST /api/v1/authorization-billing-audits/authorization/{authorizationItemId}/start`
- `POST /api/v1/authorization-billing-audits/bulk/jobs`
- `GET /api/v1/authorization-billing-audits/bulk/jobs/{id}`
- `POST /api/v1/authorization-billing-audits/bulk/jobs/{id}/confirm`
- `GET /api/v1/authorization-billing-audits/bulk/jobs/{id}/result.xlsx`
- `GET /api/v1/authorization-billing-audits/bulk/template.xlsx`

### authorization-query

- `GET /api/v1/authorization-query`
- `GET /api/v1/authorization-query/{id}`
- `GET /api/v1/authorization-query/{id}/history`

### authorizations

- `POST /api/v1/authorizations/{id}/annul`
- `PATCH /api/v1/authorizations/{id}/manual-edit`
- `POST /api/v1/authorizations/dispensation/import`
- `GET /api/v1/authorizations/dispensation/template`

### bulk-imports

- `GET /api/v1/bulk-imports`
- `GET /api/v1/bulk-imports/{id}`
- `POST /api/v1/bulk-imports/{id}/cancel`
- `POST /api/v1/bulk-imports/{id}/confirm`
- `GET /api/v1/bulk-imports/{id}/rejected.xlsx`
- `GET /api/v1/bulk-imports/{id}/result.xlsx`
- `POST /api/v1/bulk-imports/{id}/retry-failed`
- `GET /api/v1/bulk-imports/{id}/rows`
- `POST /api/v1/bulk-imports/{id}/validate`
- `GET /api/v1/bulk-imports/authorizations/template.xlsx`
- `POST /api/v1/bulk-imports/authorizations/upload`
- `GET /api/v1/bulk-imports/scheduling/template.xlsx`
- `POST /api/v1/bulk-imports/scheduling/upload`

### exportables

- `GET /api/v1/exportables/authorizations.xlsx`
- `GET /api/v1/exportables/purchase-order-candidates.xlsx`
- `GET /api/v1/exportables/purchase-orders.xlsx`

### foundation

- `POST /api/v1/foundation/events`

### fulfillment-audits

- `GET /api/v1/fulfillment-audits`
- `GET /api/v1/fulfillment-audits/{id}`
- `POST /api/v1/fulfillment-audits/{id}/approve`
- `POST /api/v1/fulfillment-audits/{id}/reject`

### fulfillments

- `POST /api/v1/fulfillments/{fulfillmentId}/audit/start`

### health

- `GET /api/v1/health`

### inventory

- `GET /api/v1/inventory`
- `GET /api/v1/inventory/availability`
- `GET /api/v1/inventory/availability/export.xlsx`
- `GET /api/v1/inventory/fefo/recommendation`
- `GET /api/v1/inventory/lots/{id}`
- `GET /api/v1/inventory/lots/{id}/movements`
- `GET /api/v1/inventory/transfers`
- `POST /api/v1/inventory/transfers`
- `GET /api/v1/inventory/transfers/{id}`
- `PATCH /api/v1/inventory/transfers/{id}`
- `POST /api/v1/inventory/transfers/{id}/cancel`
- `POST /api/v1/inventory/transfers/{id}/dispatch`
- `POST /api/v1/inventory/transfers/{id}/receive`

### me

- `GET /api/v1/me`

### medicarte

- `GET /api/v1/medicarte/applications`
- `POST /api/v1/medicarte/applications`
- `GET /api/v1/medicarte/applications/{id}`
- `PATCH /api/v1/medicarte/applications/{id}`
- `POST /api/v1/medicarte/applications/{id}/cancel`
- `POST /api/v1/medicarte/applications/{id}/confirm`
- `GET /api/v1/medicarte/applications/eligible-schedules`
- `POST /api/v1/medicarte/authorizations/{id}/fulfill`
- `GET /api/v1/medicarte/authorizations/{id}/moderator-fee`
- `POST /api/v1/medicarte/authorizations/{id}/moderator-fee`
- `GET /api/v1/medicarte/authorizations/{id}/moderator-fee/invoice-url`
- `POST /api/v1/medicarte/authorizations/fulfillment-import`
- `GET /api/v1/medicarte/authorizations/fulfillment-import/template.xlsx`
- `GET /api/v1/medicarte/deliveries`
- `GET /api/v1/medicarte/deliveries/{id}`
- `POST /api/v1/medicarte/purchase-orders/{id}/receipts`
- `POST /api/v1/medicarte/purchase-orders/{id}/reconcile-allocations`
- `GET /api/v1/medicarte/receipts`
- `POST /api/v1/medicarte/receipts`
- `GET /api/v1/medicarte/receipts/{id}`
- `PATCH /api/v1/medicarte/receipts/{id}`
- `POST /api/v1/medicarte/receipts/{id}/confirm`
- `GET /api/v1/medicarte/receipts/pending`
- `POST /api/v1/medicarte/schedules/{scheduleId}/not-applied`

### metrics

- `GET /api/v1/metrics`

### mipres

- `GET /api/v1/mipres`
- `GET /api/v1/mipres/{id}`
- `POST /api/v1/mipres/{id}/decision`
- `GET /api/v1/mipres/{id}/history`
- `POST /api/v1/mipres/{id}/recheck`
- `GET /api/v1/mipres/decision-concepts`

### modules

- `GET /api/v1/modules`

### olp

- `GET /api/v1/olp/receipts`
- `GET /api/v1/olp/receipts/{id}`

### operational-outcomes

- `GET /api/v1/operational-outcomes`
- `GET /api/v1/operational-outcomes/{id}`

### operational-status

- `GET /api/v1/operational-status`
- `GET /api/v1/operational-status/{scheduleId}`

### patient-schedules

- `GET /api/v1/patient-schedules`
- `POST /api/v1/patient-schedules`
- `GET /api/v1/patient-schedules/{id}`
- `PATCH /api/v1/patient-schedules/{id}`
- `POST /api/v1/patient-schedules/{id}/cancel`
- `GET /api/v1/patient-schedules/{id}/history`
- `POST /api/v1/patient-schedules/{id}/reschedule`
- `GET /api/v1/patient-schedules/authorizations`
- `GET /api/v1/patient-schedules/dispensing-points`
- `GET /api/v1/patient-schedules/imports`
- `POST /api/v1/patient-schedules/imports`
- `GET /api/v1/patient-schedules/imports/{importId}`
- `POST /api/v1/patient-schedules/imports/{importId}/confirm`
- `GET /api/v1/patient-schedules/imports/{importId}/rows`
- `GET /api/v1/patient-schedules/imports/template`
- `GET /api/v1/patient-schedules/timing-preview`

### planning-periods

- `GET /api/v1/planning-periods`
- `POST /api/v1/planning-periods`
- `GET /api/v1/planning-periods/{id}`
- `PATCH /api/v1/planning-periods/{id}`
- `POST /api/v1/planning-periods/{id}/consolidate`
- `POST /api/v1/planning-periods/{id}/transition`

### projected-demand

- `GET /api/v1/projected-demand`
- `GET /api/v1/projected-demand/{id}`
- `GET /api/v1/projected-demand/{id}/coverage-projection`
- `GET /api/v1/projected-demand/{id}/sources`

### purchase-demand

- `GET /api/v1/purchase-demand/available`

### purchase-orders

- `GET /api/v1/purchase-orders`
- `POST /api/v1/purchase-orders`
- `GET /api/v1/purchase-orders/{id}`
- `PATCH /api/v1/purchase-orders/{id}`
- `POST /api/v1/purchase-orders/{id}/cancel`
- `POST /api/v1/purchase-orders/{id}/issue`
- `GET /api/v1/purchase-orders/{id}/operational`
- `POST /api/v1/purchase-orders/import`
- `POST /api/v1/purchase-orders/import/reassign`
- `GET /api/v1/purchase-orders/import/template.xlsx`

### realtime

- `GET /api/v1/realtime/stream`

### reconciliation

- `GET /api/v1/reconciliation/issues`
- `GET /api/v1/reconciliation/issues/{id}`
- `POST /api/v1/reconciliation/issues/{id}/accept-risk`
- `POST /api/v1/reconciliation/issues/{id}/acknowledge`
- `POST /api/v1/reconciliation/issues/{id}/assign`
- `GET /api/v1/reconciliation/issues/{id}/comments`
- `POST /api/v1/reconciliation/issues/{id}/comments`
- `GET /api/v1/reconciliation/issues/{id}/events`
- `GET /api/v1/reconciliation/issues/{id}/findings`
- `POST /api/v1/reconciliation/issues/{id}/reopen`
- `POST /api/v1/reconciliation/issues/{id}/resolve`
- `POST /api/v1/reconciliation/issues/{id}/unassign`
- `GET /api/v1/reconciliation/issues/assignees`
- `GET /api/v1/reconciliation/notifications`
- `POST /api/v1/reconciliation/notifications/{id}/read`
- `POST /api/v1/reconciliation/notifications/read-all`
- `GET /api/v1/reconciliation/operations/executions`
- `GET /api/v1/reconciliation/operations/executions/{id}`
- `POST /api/v1/reconciliation/operations/executions/{id}/cancel`
- `GET /api/v1/reconciliation/operations/policy`
- `PUT /api/v1/reconciliation/operations/policy`
- `POST /api/v1/reconciliation/operations/policy/disable`
- `POST /api/v1/reconciliation/operations/policy/enable`
- `POST /api/v1/reconciliation/operations/trigger`
- `GET /api/v1/reconciliation/rules`
- `GET /api/v1/reconciliation/runs`
- `POST /api/v1/reconciliation/runs`
- `GET /api/v1/reconciliation/runs/{id}`
- `GET /api/v1/reconciliation/runs/{id}/findings`

### roles

- `GET /api/v1/roles`
- `POST /api/v1/roles`
- `DELETE /api/v1/roles/{roleCode}`
- `PATCH /api/v1/roles/{roleCode}`
- `GET /api/v1/roles/{roleCode}/access`
- `PUT /api/v1/roles/{roleCode}/access`

### supplier

- `GET /api/v1/supplier/deliveries`
- `POST /api/v1/supplier/deliveries`
- `GET /api/v1/supplier/deliveries/{id}`
- `PATCH /api/v1/supplier/deliveries/{id}`
- `POST /api/v1/supplier/deliveries/{id}/cancel`
- `POST /api/v1/supplier/deliveries/{id}/dispatch`
- `GET /api/v1/supplier/purchase-orders`
- `GET /api/v1/supplier/purchase-orders/{id}`
- `POST /api/v1/supplier/purchase-orders/{id}/accept`
- `POST /api/v1/supplier/purchase-orders/{id}/complete-review`
- `POST /api/v1/supplier/purchase-orders/{id}/lines/{lineId}/review`
- `POST /api/v1/supplier/purchase-orders/{id}/return`

### users

- `GET /api/v1/users`
- `POST /api/v1/users`
- `PATCH /api/v1/users/{id}`
- `PUT /api/v1/users/{id}/assignments`
- `DELETE /api/v1/users/{id}/assignments/{organizationId}`
- `DELETE /api/v1/users/{id}/assignments/{organizationId}/{roleCode}`
- `POST /api/v1/users/{id}/reset-password`

