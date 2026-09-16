# ESP-020 — Permission Inventory

Estado: **INVENTARIO ESTÁTICO COMPLETO / DECISIONES D01–D10 APPROVED**
Fuentes: migrations `0000`–`0051`, consumidores bajo `apps/api` y navegación web.

## Criterio de lectura

Las decisiones D01–D10 fueron aprobadas el 2026-09-15. Este inventario es el
baseline definitivo para WAVE 1; no implica modificar todavía
`role_permissions`, backend o frontend.

- `CURRENT` significa que el código queda presente después de aplicar todas las
  migrations actuales.
- `RETIRED` significa que fue creado por una migration anterior y eliminado por
  una migration posterior.
- “Configurable” describe el target ESP-020, no la capacidad actual. Hoy no hay
  API para editar `role_permissions`.
- `MTD_ADMIN` aparece como rol actual, pero ESP-020 debe sustituir su semántica
  implícita por `is_system_admin`/modo `ALLOW_ALL` explícito, conservando el
  código interno por compatibilidad.
- `VIEW_*` son permisos de navegación históricos. No deben seguir siendo una
  segunda fuente de verdad cuando el mapping module/action esté validado.

## 1. Inventario actual y mapping objetivo

| Permission | Domain | Target module | Target action | Roles currently using it | Actor boundary | Configurable? | Notes |
|---|---|---|---|---|---|---|---|
| `platform.foundation.execute` | Platform | Foundation | EXECUTE | `MTD_ADMIN` | MTD only; non-production probe | No | Technical/legacy; no current business route |
| `authorizations.read` | Clinical legacy | Authorizations | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `COMPENSAR_VIEWER`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Organization data boundary; OLP must not receive clinical detail | No in generic editor | Legacy code; consumer inventory required |
| `authorizations.read_sensitive` | Clinical legacy | Authorizations | VIEW_SENSITIVE | `MTD_ADMIN`, `MTD_OPERATOR`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR` | MTD-only sensitive data; current OLP/Medicarte assignment is a security review item | No | `0011` grants it to OLP/Medicarte; must not be silently propagated |
| `imports.create` | Legacy imports | Imports | CREATE | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | No | No modern consumer located |
| `imports.confirm` | Legacy imports | Imports | CONFIRM | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | No | No modern consumer located |
| `mipres.recheck` | Clinical integration | Authorizations | RECHECK | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | No | No modern consumer located |
| `application_site.read` | Clinical legacy | Applications | VIEW_SITE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Must follow actor data projection; OLP cannot see patient data | No | Legacy code |
| `audit.start` | Legacy audit | Application audits | START | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA` | MTD only | Restricted | Modern `application_audits.*` is the preferred mapping |
| `audit.reject` | Legacy audit | Application audits | REJECT | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA` | MTD only | Restricted | Legacy code |
| `audit.approve` | Legacy audit | Application audits | APPROVE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA` | MTD only | Restricted | Legacy code |
| `exports.create` | Legacy exports | Exports | CREATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `MEDICARTE_OPERATOR` | Export must use same actor projection as source module | Restricted | Modern analytics export has its own permissions |
| `users.manage` | Identity administration | Users | MANAGE | `MTD_ADMIN` | MTD system administration only | No for ordinary roles | Structural admin capability |
| `platform.jobs.manage` | Platform | Jobs | MANAGE | `MTD_ADMIN` | MTD system administration only | No | Technical capability |
| `bulk_updates.dispensation_location` | Legacy bulk | Legacy bulk updates | EDIT_DISPENSATION_LOCATION | `MTD_ADMIN`, `MEDICARTE_OPERATOR` | Medicarte point scope; MTD global | No | No modern target without consumer review |
| `bulk_updates.read` | Legacy bulk | Legacy bulk updates | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Organization projection | No | Legacy staging |
| `bulk_updates.dispensation_date` | Legacy bulk | Legacy bulk updates | EDIT_DISPENSATION_DATE | `OLP_OPERATOR` | OLP boundary | No | Consumer status must be confirmed |
| `bulk_updates.application_date` | Legacy bulk | Legacy bulk updates | EDIT_APPLICATION_DATE | `MEDICARTE_OPERATOR` | Medicarte + point scope | No | Consumer status must be confirmed |
| `operational_exports.create` | Legacy exports | Exports | CREATE_OPERATIONAL | `MTD_ADMIN`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR` | Must not cross actor projection | Restricted | `Scope.canCrossOrganizationOperationalExport` uses this |
| `bulk_updates.purchase_order` | Legacy bulk | Purchase orders | IMPORT_PURCHASE_ORDER | `MTD_ADMIN` | MTD only | No | Consumer status must be confirmed |
| `tariff_annex.read` | Configuration | Tariff configuration | VIEW | `MTD_ADMIN` | MTD only; financial/configuration boundary | No | Current role assignment is admin-only |
| `tariff_annex.create` | Configuration | Tariff configuration | CREATE | `MTD_ADMIN` | MTD only | No | Protected |
| `tariff_annex.import` | Configuration | Tariff configuration | IMPORT | `MTD_ADMIN` | MTD only | No | Protected |
| `tariff_annex.update` | Configuration | Tariff configuration | EDIT | `MTD_ADMIN` | MTD only | No | Protected |
| `tariff_annex.delete` | Configuration | Tariff configuration | DEACTIVATE | `MTD_ADMIN` | MTD only | No | Use deactivation; do not expose destructive delete |
| `dashboard.read` | Dashboard | Dashboard | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA`, `COMPENSAR_VIEWER`, `READ_ONLY` | Organization projection | Yes, within actor boundary | Distinct from `view.dashboard`; consolidate mapping |
| `audit.read` | Legacy audit | Application audits | VIEW | `MTD_ADMIN`, `MTD_AUDITORIA`, `READ_ONLY` | MTD only | Restricted | Distinct from `application_audits.read` |
| `audit.write` | Legacy audit | Application audits | EDIT | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA` | MTD only | Restricted | Distinct from `application_audits.manage` |
| `consolidated.read` | Consolidated legacy | Dashboard | VIEW_CONSOLIDATED | `MTD_ADMIN`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | MTD organization | Yes, within boundary | Historical capability |
| `view.dashboard` | Legacy navigation | Dashboard | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA`, `COMPENSAR_VIEWER`, `READ_ONLY` | Organization boundary | No | Migrate to module visibility |
| `view.authorizations` | Legacy navigation | Authorizations | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `COMPENSAR_VIEWER`, `READ_ONLY` | Organization projection | No | Migrate to module visibility |
| `view.mipres` | Legacy navigation | Authorizations | NAVIGATE_MIPRES | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY` | MTD only | No | Legacy navigation |
| `view.available` | Legacy navigation | Availability | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Actor projection | No | Route not represented by a current modern module code |
| `view.application` | Legacy navigation | Applications | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Clinical data boundary | No | Migrate to module visibility |
| `view.logistics` | Legacy navigation | Logistics | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `OLP_OPERATOR`, `READ_ONLY` | OLP/MTD projection | No | Legacy navigation |
| `view.supports` | Legacy navigation | Supports | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Actor projection | No | Legacy navigation |
| `view.audit` | Legacy navigation | Application audits | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITORIA`, `READ_ONLY` | MTD only | No | Migrate to `application_audits.read` |
| `view.consolidated` | Legacy navigation | Dashboard | NAVIGATE_CONSOLIDATED | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `COMPENSAR_VIEWER`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY` | Actor projection | No | Historical and likely orphaned |
| `view.failures` | Legacy navigation | Platform failures | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `READ_ONLY` | MTD/platform | No | No current module page found |
| `view.tariff` | Legacy navigation | Tariff configuration | NAVIGATE | `MTD_ADMIN` | MTD only | No | Must not be independently editable |
| `view.admin` | Legacy navigation | Users and access | NAVIGATE | `MTD_ADMIN` | MTD system administration | No | Replace by `users.manage` + roles/access policy |
| `view.imports` | Legacy navigation | Imports | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `READ_ONLY` | Organization projection | No | Replace by `bulk_imports.read` where applicable |
| `view.purchase_orders` | Legacy navigation | Purchase orders | NAVIGATE | `MTD_ADMIN`, `MTD_OPERATOR`, `READ_ONLY` | Organization projection | No | Replace by `purchase_orders.read` |
| `authorizations.reprocess` | Clinical legacy | Authorizations | REPROCESS | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | Restricted | No current module mapping confirmed |
| `planning_periods.read` | Planning | Planning periods | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | MTD organization | Yes, non-admin roles | Scope is organization-level |
| `planning_periods.manage` | Planning | Planning periods | MANAGE | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | Yes, within MTD boundary | State transitions remain domain-controlled |
| `patient_schedules.read` | Scheduling | Patient scheduling | VIEW | `MEDICARTE_OPERATOR`, `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | Medicarte point scope; MTD global | Yes, within actor boundary | Backend filters resource scope |
| `patient_schedules.manage` | Scheduling | Patient scheduling | MANAGE | `MEDICARTE_OPERATOR` | Medicarte + explicit point scope | Yes, within boundary | Do not grant to OLP/Compensar |
| `projected_demand.read` | Demand | Projected demand | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | MTD only | Yes, within MTD boundary | |
| `projected_demand.manage` | Demand | Projected demand | CONSOLIDATE | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | Restricted | Domain transition rules remain non-configurable |
| `purchase_orders.read` | Procurement | Purchase orders | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY`, `OLP_OPERATOR` | MTD/OLP projection; no patient data for OLP | Yes, within boundary | |
| `purchase_orders.manage` | Procurement | Purchase orders | MANAGE | `MTD_ADMIN`, `MTD_OPERATOR` | MTD only | Yes, within MTD boundary | |
| `purchase_orders.review_supplier` | Procurement | Purchase orders | REVIEW_SUPPLIER | `OLP_OPERATOR` | OLP only; no clinical details | No across actor boundary | |
| `supplier_deliveries.read` | Logistics | OLP deliveries | VIEW | `OLP_OPERATOR`, `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY`, `MEDICARTE_OPERATOR` | Actor-specific projection | Yes, within boundary | |
| `supplier_deliveries.manage` | Logistics | OLP deliveries | MANAGE/DISPATCH | `OLP_OPERATOR` | OLP only | No across actor boundary | |
| `medicarte_receipts.read` | Receipts | Receipts | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR` | Medicarte point scope for operational records | Yes, within boundary | |
| `medicarte_receipts.manage` | Receipts | Receipts | RECEIVE/CONFIRM | `MEDICARTE_OPERATOR` | Medicarte + explicit point scope | Yes, within boundary | |
| `inventory.read` | Inventory | Inventory | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `MEDICARTE_OPERATOR` | Medicarte point scope; MTD global | Yes, within boundary | `READ_ONLY` is not assigned in current migration |
| `stock_transfers.read` | Inventory | Transfers | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `MEDICARTE_OPERATOR` | Medicarte point scope; MTD global | Yes, within boundary | |
| `stock_transfers.manage` | Inventory | Transfers | TRANSFER | `MEDICARTE_OPERATOR` | Medicarte source AND destination scope | Yes, within boundary | ESP-015 requires source and destination |
| `patient_applications.read` | Applications | Patient applications | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY`, `MEDICARTE_OPERATOR` | Medicarte point scope; MTD global | Yes, within boundary | |
| `patient_applications.manage` | Applications | Patient applications | APPLY/MANAGE | `MEDICARTE_OPERATOR` | Medicarte + explicit point scope | Yes, within boundary | Inventory mutation remains domain-controlled |
| `patient_operational_outcomes.read` | Outcomes | Operational outcomes | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY`, `MEDICARTE_OPERATOR` | Medicarte point scope; MTD global | Yes, within boundary | |
| `patient_operational_outcomes.manage` | Outcomes | Operational outcomes | RECORD | `MEDICARTE_OPERATOR` | Medicarte + explicit point scope | Yes, within boundary | |
| `application_audits.read` | Audit | Application audits | VIEW | `MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY` | MTD only | Restricted | |
| `application_audits.manage` | Audit | Application audits | REVIEW/DECIDE | `MTD_ADMIN`, `MTD_AUDITORIA` | MTD only | Restricted | State transitions and evidence rules are structural |
| `analytics.read` | Analytics | Analytics | VIEW | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | MTD only | Restricted | |
| `analytics.economics.read` | Analytics | Analytics | VIEW_ECONOMICS | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | MTD financial read boundary | Restricted | Sensitive sub-capability |
| `bulk_imports.read` | Bulk operations | Imports | VIEW | `MEDICARTE_OPERATOR`, `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` | Medicarte point scope plus MTD global | Yes, within boundary | |
| `bulk_imports.manage` | Bulk operations | Imports | IMPORT/CONFIRM | `MEDICARTE_OPERATOR` | Medicarte + point scope | Yes, within boundary | Confirm revalidates each row |
| `operational_scopes.read` | Access administration | Point scopes | VIEW | `MTD_ADMIN`, `MTD_AUDITORIA` | MTD administration only | No for generic role editor | |
| `operational_scopes.manage` | Access administration | Point scopes | ASSIGN | `MTD_ADMIN` | MTD administration; target Medicarte points only | No for generic role editor | Must remain separate from module access |
| `reconciliation.read` | Integrity | Operational integrity | VIEW | `MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY` | MTD only | Restricted | ESP-017 |
| `reconciliation.run` | Integrity | Operational integrity | RUN | `MTD_ADMIN`, `MTD_AUDITORIA` | MTD only | Restricted | ESP-017 |
| `reconciliation_issues.read` | Integrity | Operational integrity | VIEW_ISSUES | `MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY` | MTD only | Restricted | ESP-018 |
| `reconciliation_issues.triage` | Integrity | Operational integrity | TRIAGE | `MTD_ADMIN`, `MTD_AUDITORIA` | MTD only | Restricted | Assignment/resolution are governed actions |
| `reconciliation_issues.comment` | Integrity | Operational integrity | COMMENT | `MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR` | MTD only | Restricted | |
| `reconciliation_operations.read` | Integrity | Reconciliation operations | VIEW | `MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY` | MTD only | Restricted | ESP-019 |
| `reconciliation_operations.manage` | Integrity | Reconciliation operations | CONFIGURE/RUN | `MTD_ADMIN` | MTD only | No for generic role editor | Scheduler policy is high-impact |
| `reconciliation_notifications.read` | Integrity | Reconciliation operations | VIEW_NOTIFICATIONS | `MTD_ADMIN`, `MTD_AUDITORIA`, `MTD_OPERATOR`, `MTD_GENERAL`, `READ_ONLY` | MTD only | Restricted | ESP-019 |

## 2. Permisos retirados históricamente

Estos códigos aparecen en la historia de ESP-001…ESP-019, pero
`0024_remove_notifications.sql` y `0006_phase5_dispensing_application.sql`
los eliminan del catálogo actual:

| Permission | Origin | Target | Status | Action |
|---|---|---|---|---|
| `application_site.assign` | `0000_foundation.sql` | Applications | RETIRED | No reactivar sin consumidor actual |
| `dispensing.register` | `0000_foundation.sql` | Dispensing legacy | RETIRED | No reactivar |
| `attachments.upload` | `0000_foundation.sql` | Attachments | RETIRED | No reactivar |
| `attachments.read` | `0000_foundation.sql` | Attachments | RETIRED | No reactivar |
| `notifications.manage` | `0005_phase4_operational_notifications.sql` | Notifications | RETIRED | No reactivar; ESP-019 usa in-app notifications |
| `view.notifications` | `0019_rbac_profiles.sql` | Notifications | RETIRED | No reactivar |

## 3. Resultado del inventario

- Códigos actualmente sembrados: **79**.
- Códigos retirados históricamente: **6**.
- El inventario de roles se basa en `role_permissions` sembrados por migrations;
  no existe una API para editarlo hoy.
- No hay evidencia suficiente para convertir automáticamente los 79 códigos en
  checkboxes sin un mapping validado por consumidor.
- Los códigos legacy y `view.*` no deben aparecer en la UI de roles hasta que
  se confirme si siguen protegiendo endpoints.

## 4. Gate obligatorio antes de código

El futuro `ESP020-T005` debe producir una validación que:

1. lea todos los códigos de `permissions`;
2. lea todos los permission checks de API;
3. lea todas las rutas de navegación;
4. exija una fila de registry por cada código activo;
5. marque `ORPHAN`, `UNMAPPED`, `RETIRED` y `STRUCTURAL`;
6. falle el build si un permiso usado por backend no tiene mapping aprobado.

El administrador no puede configurar:

- permisos estructurales de actor;
- `users.manage`;
- `operational_scopes.manage`;
- reglas de reconciliación MTD;
- acceso financiero o de configuración fuera de MTD;
- cualquier permiso que no tenga boundary validado.

## 5. Decisiones aprobadas aplicadas al inventario

- **D01:** `MTD_ADMIN` usa `ALLOW_ALL` explícito mediante metadata de rol; no se
  agregará `SYSTEM_ADMIN`.
- **D02:** solo roles predefinidos; la columna `Configurable?` se aplica
  únicamente a capabilities expresamente permitidas.
- **D03:** actor boundaries y compatibilidad organización–rol son estructurales,
  no configurables desde UI/DB.
- **D05:** lifecycle de permissions se mantiene en el registry/código como
  `ACTIVE`, `LEGACY`, `ORPHAN` o `RETIRED`; no se eliminan códigos
  destructivamente en ESP-020.
- **D07:** point scope no se convierte en permission ni se generaliza a OLP o
  COMPENSAR.

