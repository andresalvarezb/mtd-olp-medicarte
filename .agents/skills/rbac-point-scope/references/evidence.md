# Evidencia inicial: acceso

- `.agent/adr/ADR-038-esp-015-organization-point-access.md`: RBAC, data scope, IDOR y revalidación.
- `apps/api/src/identity/access.service.ts`: perfil, organizaciones, roles y permisos.
- `apps/api/src/access-scopes/operational-access-scope.service.ts`: resolución del alcance operativo.
- `apps/api/src/common/point-scope.sql.ts`: filtros y locks de grants activos.
- `apps/api/src/common/request-scope.ts`: forma del actor y tipo de alcance.
- `apps/api/src/purchase-orders/purchase-order-visibility.test.ts`
- `apps/api/src/product-delivery-points/product-delivery-point-xlsx.test.ts`

## Casos condicionales

- Recursos por id y exports: seguir controller → servicio → repositorio y comprobar que el filtro no exista solo en el listado.
- Bulk/imports: revisar `apps/api/src/bulk-imports/` y servicios `*-bulk.service.ts`; definir rechazo total o parcial y revalidar cada fila al escribir.
- Workers/jobs: comprobar que el actor o scope se propague y que una ejecución diferida no reutilice grants revocados.

Buscar endpoints y repositorios con `rg -n "<recurso|permiso|scope>" apps/api/src packages`. Ejecutar pruebas enfocadas con `pnpm --filter @authorization/api test -- <ruta.test.ts>` y `pnpm typecheck` si cambia el contrato. Una comprobación de UI no sustituye la restricción SQL.
