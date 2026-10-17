# Permisos, organizaciones, puntos y combinaciones complejas (RBAC)

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

## Modelo de autorización comprobado

El backend exige identidad autenticada, `X-Organization-Id`, permiso concedido y permiso admisible para el rol/organización. Un permiso aparente en la interfaz **no sustituye** la autorización del controlador; algunos flujos bloquean además el cambio dentro de la transacción. El alcance por punto puede restringir incluso una acción concedida por RBAC. `MTD_ADMIN` está protegido y tiene reglas específicas de administrador de sistema.

| Organización | Roles predefinidos permitidos según código | Observación |
| --- | --- | --- |
| MTD | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | Autoridad y permisos específicos por función |
| MEDICARTE | `MEDICARTE_OPERATOR`, `READ_ONLY` | Punto de dispensación y gestión operativa |
| OLP | `OLP_OPERATOR`, `READ_ONLY` | Aceptación, logística, despachos |
| COMPENSAR | `COMPENSAR_VIEWER`, `READ_ONLY` | Visibilidad observadora limitada |

**Nota:** existen roles personalizados con código `CUSTOM_` y alcance organizacional configurable. La matriz anterior **solo enumera roles predefinidos**; no asegura que cada uno tenga todas las acciones posibles.

| ID | Excepción | Control en código y prueba necesaria | Estado |
| --- | --- | --- | --- |
| CE-76 | Usuario sin `X-Organization-Id` | `ORGANIZATION_REQUIRED` o validación UUID, según controlador | IMPLEMENTADO EN FUENTE |
| CE-77 | Permiso presente pero rol no compatible | Comprobación doble `scope.permissions` + `isPermissionAllowedForActor`; denegación | IMPLEMENTADO EN FUENTE |
| CE-78 | Operador MEDICARTE intenta cambiar decisión MIPRES | Bloqueo MTD-only y `mipres.decision.manage` | IMPLEMENTADO EN FUENTE |
| CE-79 | Usuario con permisos de un punto consulta otro | Restricciones `applyPointScope` / `assertCanAccessPoint` y revocación de grants | IMPLEMENTADO EN FUENTE |
| CE-80 | Solo `analytics.read` intenta ver economía | Requiere `analytics.economics.read`; export sin economía cuando falta | IMPLEMENTADO EN FUENTE |
| CE-81 | Rol personalizado limitado a otras organizaciones | `role_organization_scopes`, validación asignaciones activas y `ROLE_SCOPE_ASSIGNMENTS_CONFLICT` al restringir alcance | IMPLEMENTADO EN FUENTE |
| CE-82 | Modificar rol predefinido/protegido | Rechazo `ROLE_PROTECTED` para edición estructural; permisos editables según registry | IMPLEMENTADO EN FUENTE |
| CE-83 | COMPENSAR intenta operación de escritura | Solo rol viewer/READ_ONLY; comprobar 403 por módulo y permiso, no por ocultamiento UI | IMPLEMENTADO EN FUENTE / VALIDACIÓN PENDIENTE |
| CE-84 | Auditoría/recepción con permiso pero recurso fuera de organización/punto | Verificar permiso, alcance y lock actual en servidor; prevenir fuga multi-tenant | IMPLEMENTADO EN FUENTE / VALIDACIÓN PENDIENTE |

## Permisos para procesos cubiertos

| Recurso/operación | Permiso requerido por controlador |
| --- | --- |
| MIPRES decisión manual | `mipres.decision.manage` |
| MIPRES recheck | `mipres.recheck` |
| Agenda listar / mutar | `patient_schedules.read` / `patient_schedules.manage` |
| No aplicación | `patient_operational_outcomes.manage` |
| Recepción MEDICARTE | `medicarte_receipts.read` / `medicarte_receipts.manage` |
| Traslados | `stock_transfers.read` / `stock_transfers.manage` |
| Roles y accesos | `users.manage` |
| Analíticas / economía | `analytics.read` / `analytics.economics.read` |
| Auditoría de facturación | `application_audits.read` / `application_audits.manage` (ver [auditoría](auditoria-facturacion.md)) |
| Conciliación | `reconciliation.*`, `reconciliation_issues.*`, `reconciliation_operations.*`, `reconciliation_notifications.*`, según acción |

## Casos de alta prioridad

1. Permiso `manage` sin permiso `read`: verificar decisiones de backend y navegación por separado.
2. Revocación de punto **entre lectura y confirmación**: revalidar en transacción las operaciones con stock/recepción.
3. Múltiples roles del mismo usuario en una organización: permisos efectivos y bypass exclusivos de rol autorizado.
4. Usuario en dos organizaciones: no permitir aplicar autorización de una organización usando cabecera de otra.
5. Permisos personalizados: cambio concurrente de permisos durante una operación sensible; repetir la validación de autoridad.

**Fuentes:** `apps/api/src/identity/{access.service,role-access.controller,role-access.service}.ts`, `packages/domain/src/organization-role-policy.ts`, `packages/contracts/src/roles.ts`, `.agent/specs/ESP-020-permission-inventory.md` (inventario de diseño, validar vigencia), migraciones 0057 y 0091, controladores citados.
