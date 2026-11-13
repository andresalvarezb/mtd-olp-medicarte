# Puntos de partida para exportables

- `apps/api/src/exportables/exportables.service.ts`: exportables de autorizaciones y AUTO para OC; revisar consultas, composición de hojas y `safeSpreadsheetValue`.
- `apps/api/src/exportables/exportables.controller.ts`: permiso y entrada.
- `apps/api/src/exportables/exportables.service.test.ts`: encabezados, filas y fuente de punto de AUTO para OC.
- `apps/api/src/exportables/exportables-authorization-filter.test.ts`: filtros de autorización.
- `docs/requirements/RF-MTD-CM-002-recaudo-devoluciones.md`: columnas financieras del exportable de autorizaciones.

Confirmar rutas actuales con `rg -n 'purchaseOrderCandidates|authorizations|aoa_to_sheet|sheet_to_json' apps/api/src/exportables`. Cada hoja tiene su propia cardinalidad y contrato; no extrapolar uno a otro.
