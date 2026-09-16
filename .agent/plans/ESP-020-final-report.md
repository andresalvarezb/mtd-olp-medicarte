# ESP-020 — Final Architecture Report

Estado: **WAVE 1 IMPLEMENTADA / WAVE 2+ NO IMPLEMENTADA / D01–D10 APPROVED**

Fecha de cierre documental: **2026-09-15**. WAVE 1 modificó únicamente el
registry, policies, metadata schema/migration, resolver de acceso y gates.
WAVE 2+ no modificó bootstrap, guards, `/me`, sidebar, UI ni `reset.ts`.

## A. CURRENT STATE

Existe RBAC persistido en `roles`, `permissions`, `role_permissions` y
`user_organization_roles`. ESP-015 añade `user_point_scopes` y
`OperationalAccessScopeService`. No existe module registry ni role-access API.

Detalle: `ESP-020-current-state-audit.md`.

## B. WHY TOO MANY USERS EXIST

Las migrations `0000` y `0005` insertan cuentas demo; el bootstrap crea hasta
tres cuentas adicionales; Docker/Render configuran bootstrap; los tests crean
fixtures por API. No existe provenance unificada.

## C. CURRENT RBAC MODEL

Roles globales ligados a organización por `user_organization_roles`; permisos
globales ligados por `role_permissions`; múltiples roles por usuario/org;
backend resuelve desde PostgreSQL en cada request.

## D. CURRENT POINT SCOPE MODEL

MTD es global; `MEDICARTE_OPERATOR` es explicit y fail-closed; OLP/Compensar no
usan point grants. La autorización efectiva es RBAC AND data scope.

## E. CURRENT ADMINISTRATION UI

`/administracion` combina usuarios y scopes. Usuarios, organizaciones y roles
están hardcoded; no existe lista/editor de roles; revocar por UI puede afectar
todos los roles de una organización.

## F. TARGET ARCHITECTURE

```text
USER → ORGANIZATION → ROLE → MODULE ACCESS → ACTIONS → DATA SCOPE
```

Se conserva `role_permissions`; el registry module/action es metadata
compartida, no autoridad de seguridad.

## G. ADMIN SEMANTICS

Conservar código `MTD_ADMIN`, presentarlo como `Administrador` y añadir
metadata de role protegido `is_system_admin=true`. Resolver `ALLOW_ALL` contra
acciones `system_allowed`; scope MTD global, sin grants artificiales.

## H. CLEAN INSTALL BOOTSTRAP

Una instalación limpia debe terminar con exactamente un usuario administrador.
Bootstrap single-target, idempotente, lock transaccional, sin overwrite de
password ni secrets en logs.

## I. EXISTING USER MIGRATION

Preservar users reales/unknown, assignments, scopes y audit. Clasificar solo
fixtures deterministas; cualquier cleanup requiere dry-run, evidencia y
`MANUAL_REVIEW`.

## J. MODULE REGISTRY

Ubicación recomendada: `packages/contracts/src/access-registry.ts`, consumida por
API y Web. Enforcement de actor boundaries permanece en backend/domain.

## K. PERMISSION → MODULE/ACTION MAPPING

Se inventariaron **79 códigos actuales** y **6 retirados históricamente**.
Cada fila tiene domain, module, action, roles actuales, boundary, configuración y
notas en `ESP-020-permission-inventory.md`.

## L. ACTOR HARD BOUNDARIES

MTD administrativo/reconciliación/configuración; Medicarte operación clínica y
física con point scope; OLP procurement/deliveries sin clínica; Compensar
consulta histórica. No son checkboxes genéricos.

## M. TARGET USER UX

Lista limpia, creación en tres pasos, detalle con asignaciones/scope/security
metadata/audit, activación segura y reset solo si el backend lo soporta.

## N. TARGET ROLE UX

Cards/table de roles predefinidos, conteo de módulos/usuarios y editor
module→actions. `Administrador` es read-only/protected.

## O. TARGET SIDEBAR

Derivado de `/me.accessibleModules`, agrupado por secciones; módulo no autorizado
no aparece y una sección vacía se oculta.

## P. DATABASE IMPACT

No se recomiendan tablas `role_module_access`/`role_module_actions` sin gap
demostrado. El plan aprobado contiene una única migration aditiva para
`roles.is_system_admin`, `roles.is_system_managed` y `users.provenance`, con
default/backfill seguro `UNKNOWN`. Lifecycle de permissions y policy
organization–role permanecen en registry/domain; no requieren tablas nuevas.
`MIGRATIONS_EXPECTED=1`.

## Q. API IMPACT

Evolucionar `/users`, añadir detalle y revocación precisa; agregar
`/roles`, `/roles/:roleCode/access`, `/modules`, audit queries y enriquecer
`GET /me`. Mantener compatibilidad durante transición.

## R. AUDIT IMPACT

Agregar eventos de user lifecycle, role changes, module access, permission
changes, scopes y bootstrap. Audit identity/access debe ser transaccional; no
guardar password, hash, JWT ni secrets.

## S. SECURITY INVARIANTS

- Backend es autoridad.
- `RBAC_PERMISSION AND RESOURCE_WITHIN_DATA_SCOPE`.
- Actor boundaries no configurables.
- Admin global no requiere point grants.
- Medicarte sin grants queda fail-closed.
- Último admin protegido con transaction + advisory lock.
- No authority en frontend, Redis o memoria.

## T. IMPLEMENTATION PHASES

0. Audit/decisions; 1. registry/policy; 2. identity/bootstrap; 3. backend
APIs/`/me`; 4. navigation; 5. UX; 6. migration/compatibility; 7. hardening;
8. certification.

## U. TASK LIST

`ESP020-T001` … `ESP020-T039`, descritas individualmente en
`ESP-020-tasks.md`.

## V. DEPENDENCY GRAPH

El DAG Mermaid completo está en `ESP-020-tasks.md`.

## W. IMPLEMENTATION WAVES

W1 Foundations / Security Model (`T002,T003,T004,T006–T012,T039`); W2 Backend
authorization/identity; W3 Navigation and Admin UX; W4 Migration/deployment;
W5 Security certification; W6 Full regression.

## X. GATES

`tests/integration/gate-esp020-wave1.test.ts` (11 cases): registry uniqueness,
ACTIVE mapping/lifecycle, MTD_ADMIN metadata and ALLOW_ALL, predefined-role
protection, organization–role matrix, actor boundaries, provenance neutrality
and ESP-015 semantics. Después: `W2` backend/actor/scope; `W3`
UX/navigation; `W4` migration/clean install; `W5` security/audit; `W6` full
regression.

## Y. TEST STRATEGY

Clean bootstrap, redeploy, concurrent bootstrap, admin allow-all, last-admin
concurrency, users lifecycle, role matrix, module visibility, direct route/API
403, actor boundaries, ESP-015, audit secrecy/atomicity, migration
preservation, frontend sidebar and role editor.

## Z. RISKS

Lockout admin; privilege escalation; actor bypass; stale frontend; role edit
race; destructive migration; point-scope regression; fixture leakage;
sidebar/API mismatch; incomplete permission mapping.

Mitigations y tareas están registradas en `ESP-020-tasks.md`.

## AA. APPROVED DECISIONS

```text
D01=A  MTD_ADMIN + role metadata + ALLOW_ALL; no SYSTEM_ADMIN/user flag
D02=A  Solo roles predefinidos
D03=B  Policy canónica organization–role en domain
D04=A  Selector explícito; preservar multi-organización
D05=B  Lifecycle legacy; no eliminación destructiva
D06=B  Provenance mínima persistida; UNKNOWN si no hay evidencia
D07=A  MTD global; MEDICARTE explicit fail-closed; OLP/COMPENSAR sin grants
D08=B  Audit atómico para mutaciones identity/access
D09=A  reset.ts bloqueado en production sin bypass
D10=B  No editar migrations históricas; clean path explícito y existing conservador
```

`PRODUCT_DECISIONS_PENDING=0`.

## AB. OUT OF SCOPE

SSO, OAuth social, MFA, LDAP, SCIM, IAM externo, passwordless, custom-role
marketplace, approval workflow, JIT/temporary access, ABAC general-purpose,
reemplazo de JWT/Argon2id y rediseño de organizations.

## AC. DEFINITION OF DONE

Clean install = 1 admin; no runtime demos; admin allow-all/global; last-admin
safe; role access module/action; backend authority; boundaries y ESP-015
preserved; dynamic `/me`/sidebar; users/roles UX; direct URL/API denied;
existing users preserved; audit events; all regression gates green.

## AD. FILES CREATED

### Specifications

- `.agent/specs/ESP-020-current-state-audit.md`
- `.agent/specs/ESP-020-permission-inventory.md`
- `.agent/specs/ESP-020-user-seed-inventory.md`
- `.agent/specs/ESP-020-target-architecture.md`
- `.agent/specs/ESP-020-ux-specification.md`
- `.agent/specs/ESP-020-user-role-module-access-redesign.md`

### Plans

- `.agent/plans/ESP-020-implementation-plan.md`
- `.agent/plans/ESP-020-tasks.md`
- `.agent/plans/ESP-020-final-report.md`
- `.agent/plans/ESP-020-wave-1-implementation-prompt.md`

### WAVE 1 implementation

- `packages/contracts/src/access-registry.ts`
- `packages/domain/src/organization-role-policy.ts`
- `packages/domain/src/actor-boundary-policy.ts`
- `packages/domain/src/admin-access-policy.ts`
- `packages/database/migrations/0052_esp020_identity_access_metadata.sql`
- `tests/integration/gate-esp020-wave1.test.ts`

## AE. IMPLEMENTATION BRANCH AND NEXT ACTION

La rama prevista es `feat/esp-020-user-role-module-access`. Debe crearse desde
el HEAD aceptado de ESP-019, sin incluir cambios productivos ajenos ni esta fase
documental si el workflow exige cerrar primero la rama actual.

La siguiente acción aprobada es ejecutar exclusivamente el contenido de
`.agent/plans/ESP-020-wave-1-implementation-prompt.md`.

## Metrics

```text
TOTAL_TASKS_BEFORE=38
TOTAL_TASKS_AFTER=39
UPDATED_TASKS=T002,T003,T004,T006,T007,T008,T009,T010,T011,T012,T013,T014,T015,T016,T017,T019,T020,T021,T022,T023,T024,T028,T029,T030,T031,T032,T033,T034,T035,T037,T038
MERGED_TASKS=none
SPLIT_TASKS=none
CANCELLED_TASKS=T005
NEW_TASKS=T039
CRITICAL_PATH=T001,T002,T008,T009,T010,T012,T039,T013,T015,T016,T037,T038
PARALLELIZABLE_TASKS=T002,T003,T004,T006,T007,T009,T010,T013,T018,T035,T014,T019,T020,T021,T023,T027,T028,T029,T030
MIGRATIONS_EXPECTED=1
WAVE_1_STATUS=IMPLEMENTED
WAVE_1_TASKS=T002,T003,T004,T006,T007,T008,T009,T010,T011,T012,T039
WAVE_1_ENTRY_CRITERIA=Decisiones D01-D10 APPROVED; inventories de permissions/modules completos; matriz organization-role y actor boundaries definidas; migration plan establecido
WAVE_1_EXIT_CRITERIA=Registry/mapping/lifecycle completos; ALLOW_ALL y policy verificados; provenance neutral; ESP-015 intacto; gate W1 verde
GATE_W1_CASES=11
REGRESSION_GATES=tests/integration/gate-f1.test.ts; tests/integration/gate-f7-user-management.test.ts; tests/integration/gate-esp015.test.ts; tests/integration/gate-esp016.test.ts; tests/integration/gate-esp017.test.ts; tests/integration/gate-esp018.test.ts; tests/integration/gate-esp019.test.ts
PRODUCT_DECISIONS_PENDING=0
TECHNICAL_BLOCKERS_PENDING=0
```

