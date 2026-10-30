# Evidencia inicial: acceso

- `.agent/adr/ADR-038-esp-015-organization-point-access.md`: RBAC, data scope, IDOR y revalidación.
- `apps/api/src/identity/access.service.ts`: perfil, organizaciones, roles y permisos.
- `apps/api/src/access-scopes/operational-access-scope.service.ts`: resolución del alcance operativo.
- `apps/api/src/common/point-scope.sql.ts`: filtros y locks de grants activos.
- `apps/api/src/common/request-scope.ts`: forma del actor y tipo de alcance.
- `apps/api/src/purchase-orders/purchase-order-visibility.test.ts`
- `apps/api/src/product-delivery-points/product-delivery-point-xlsx.test.ts`

Buscar todos los endpoints y repositorios que leen o mutan el recurso; una comprobación de UI no sustituye la restricción SQL.
