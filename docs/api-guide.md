# Mapa de API y autenticación

**Corte:** `develop` @ `7ced5792` (2026-10-17). Todas las rutas de esta guía
se leen con prefijo `/api/v1`, definido en `apps/api/src/main.ts`.

La **fuente más precisa del contrato HTTP** es Swagger en
`http://localhost:3001/api/v1/docs`, o `GET /api/v1/openapi.json` cuando
el servicio está levantado. Este inventario no sustituye los esquemas Zod,
los permisos de cada acción ni la descripción de respuestas.

## Sesión y permisos

`POST /auth/login` emite la sesión local (consultar contrato en Swagger).
Las operaciones protegidas requieren encabezado `Authorization: Bearer <token>`;
varias rutas exigen `X-Organization-Id: <uuid>`. El backend comprueba usuario
activo, permisos y pertenencia a organización; ciertas operaciones también
limitan el punto operativo. No asumir que conocer un ID habilita su lectura.

Ejemplo para API local, con credenciales obtenidas previamente:

```bash
curl -i 'http://localhost:3001/api/v1/authorization-query' \
  -H 'Authorization: Bearer TOKEN_DE_SESION' \
  -H 'X-Organization-Id: UUID_DE_ORGANIZACION'
```

No exponer tokens ni información clínica en capturas, logs o ejemplos públicos.

## Rutas principales observadas

| Dominio | Rutas representativas | Código |
| --- | --- | --- |
| Autenticación | `POST /auth/login`, `POST /auth/change-password` | `identity/auth.controller.ts` |
| Usuarios y roles | `GET/POST /users`, `GET/POST /roles`, `GET /modules` | `identity/*controller.ts` |
| Consulta AUTO | `GET /authorization-query`, `GET /authorization-query/:id`, `GET /authorization-query/:id/history` | `clinical/authorization-query.controller.ts` |
| Edición/anulación AUTO | `PATCH /authorizations/:id/manual-edit`, `POST /authorizations/:id/annul` | `clinical/authorization-manual-edit.controller.ts` |
| Importaciones | `POST /bulk-imports/authorizations/upload`, `POST /bulk-imports/:id/validate`, `POST /bulk-imports/:id/confirm` | `bulk-imports/bulk-import.controller.ts` |
| Anexo tarifario | `POST /admin/tariff-annex/imports`, `POST /admin/tariff-annex/imports/:importId/prepare`, `POST /admin/tariff-annex/imports/:importId/confirm` | `tariff-annex/tariff-annex.controller.ts` |
| Programación | `GET/POST /patient-schedules`, `POST /patient-schedules/:id/reschedule` | `scheduling/patient-schedule.controller.ts` |
| Planeación | `GET/POST /planning-periods`, `POST /planning-periods/:id/transition` | `planning/planning-period.controller.ts` |
| Demanda | `POST /planning-periods/:id/consolidate`, `GET /projected-demand` | `consolidation/projected-demand.controller.ts` |
| Compras MTD | `GET/POST /purchase-orders`, `POST /purchase-orders/:id/issue`, `POST /purchase-orders/:id/cancel` | `purchase-orders/purchase-order.controller.ts` |
| Importar OC | `GET /purchase-orders/import/template.xlsx`, `POST /purchase-orders/import` | `purchase-orders/purchase-order-import.controller.ts` |
| Proveedor OLP | `GET /supplier/purchase-orders`, `POST /supplier/purchase-orders/:id/accept`, `POST /supplier/purchase-orders/:id/complete-review` | `purchase-orders/purchase-order.controller.ts` |
| Recepción moderna | `POST /medicarte/purchase-orders/:id/receipts` | `receipts/receipt.controller.ts` |
| Inventario | `GET /inventory`, `GET /inventory/availability`, `GET /inventory/availability/export.xlsx` | `inventory/*controller.ts` |
| Traslados | `GET/POST /inventory/transfers`, `POST /inventory/transfers/:id/dispatch`, `POST /inventory/transfers/:id/receive` | `inventory/stock-transfer.controller.ts` |
| Atención | `POST /medicarte/authorizations/:id/fulfill` | `fulfillments/authorization-fulfillment.controller.ts` |
| Auditoría de facturación | `GET /authorization-billing-audits/authorization/:authorizationItemId`, `POST /authorization-billing-audits/:auditId/decision` | `audits/authorization-billing-audit.controller.ts` |
| Auditoría masiva de facturación | `POST /authorization-billing-audits/bulk/jobs`, `POST /authorization-billing-audits/bulk/jobs/:id/confirm`, `GET /authorization-billing-audits/bulk/jobs/:id/result.xlsx` | `audits/authorization-billing-audit-bulk.controller.ts` |
| Exportables | `GET /exportables/authorizations.xlsx`, `GET /exportables/purchase-orders.xlsx`, `GET /exportables/purchase-order-candidates.xlsx` | `exportables/exportables.controller.ts` |
| MIPRES | `GET /mipres`, `GET /mipres/:id/history`, `POST /mipres/:id/decision` | `mipres/*controller.ts` |
| Analítica | `GET /analytics/dashboard`, `GET /analytics/operational`, `GET /analytics/export.xlsx` | `analytics/analytics.controller.ts` |
| Reconciliación | `GET/POST /reconciliation/runs`, `GET /reconciliation/issues`, `POST /reconciliation/operations/trigger` | `reconciliation/reconciliation.controller.ts` |
| SSE | `GET /realtime/stream` | `realtime/realtime.controller.ts` |

Los controladores de `applications`, `outcomes`, `deliveries`, `audits` y otros
módulos registrados en `AppModule` también ofrecen rutas; consulte OpenAPI
para el inventario completo, métodos, permisos y cuerpos.

## Semántica que importa al consumir API

- **Estados distintos:** habilitación AUTO, vigencia, asignación y progreso de
  atención son dimensiones separadas. No deducir una de otra.
- **Anulación:** requiere motivo, versión esperada y precondiciones de consumo;
  no cancela automáticamente las OC históricas. Ver
  [BR-AUTO-ANNUL-001](requirements/BR-AUTO-ANNUL-001-anulacion-autorizacion.md).
- **Renovación:** la transición efectiva 16 → 5 no salta otras compuertas.
- **Recepción:** cantidad de OC no equivale a existencia disponible.
- **Exportables XLSX:** descargar como archivo binario, no interpretar como
  JSON. El estado de auditoría de facturación proviene de persistencia.
- **Realtime:** el stream SSE requiere JWT Bearer; sus eventos invalidan
  modelos de lectura y obligan a refetch, no son un canal de mutación.

Consultar las validaciones, schemas e invariantes de cada ruta antes de
integrar consumidores externos. Esta guía documenta lo que existe en el árbol
del repositorio, no un contrato de compatibilidad perpetuo.
