# ESP-020 — WAVE 1 Implementation Prompt

## Role and objective

Actúa como agente implementador Senior para ejecutar exclusivamente:

**WAVE 1 — Foundations / Security Model**

El objetivo es cerrar el modelo canónico de módulos, permisos, boundaries,
semántica de administrador y provenance mínima. No implementes WAVE 2 ni ninguna
UX/API posterior.

## Branch and source

Crear o usar la rama:

```text
feat/esp-020-user-role-module-access
```

El punto de partida aceptado es exactamente:

```text
caad35a080c011137fb7c53fa6908e35fbb4d0ef
```

Es el HEAD aceptado de la rama de ESP-019 al cierre de planificación e incluye
el ajuste de navegación posterior a ESP-019. No reescribas ese historial y no
incluyas cambios ajenos a ESP-020.

## Approved baseline

Las decisiones D01–D10 fueron aprobadas el 2026-09-15:

```text
D01=A  MTD_ADMIN, label Administrador, role flags y ALLOW_ALL explícito
D02=A  Solo roles predefinidos
D03=B  Policy canónica organization–role en domain, no configurable
D04=A  Preservar multi-organización; selector activo disponible en la topbar
D05=B  No borrar permissions legacy; clasificar lifecycle
D06=B  Persistir provenance mínima; UNKNOWN si no existe evidencia
D07=A  Mantener ESP-015 exactamente
D08=B  Audit atómico; la implementación completa queda fuera de WAVE 1
D09=A  reset.ts bloqueado en production; queda fuera de WAVE 1
D10=B  No editar migrations históricas; clean/existing flow conservador
```

Documentos normativos:

- `.agent/specs/ESP-020-current-state-audit.md`
- `.agent/specs/ESP-020-permission-inventory.md`
- `.agent/specs/ESP-020-user-seed-inventory.md`
- `.agent/specs/ESP-020-target-architecture.md`
- `.agent/specs/ESP-020-ux-specification.md`
- `.agent/specs/ESP-020-user-role-module-access-redesign.md`
- `.agent/plans/ESP-020-implementation-plan.md`
- `.agent/plans/ESP-020-tasks.md`

## Exact WAVE 1 tasks

Implement and verify only:

- **T002:** validate all permission consumers and classify
  `ACTIVE`, `LEGACY`, `ORPHAN`, `RETIRED`;
- **T003:** close the module/route/action inventory;
- **T004:** close seed-source/provenance classification without deletion;
- **T006:** implement the organization–role compatibility policy;
- **T007:** implement role metadata contract and explicit admin semantics;
- **T008:** implement the canonical module/action registry;
- **T009:** implement permission mapping completeness/orphan gate;
- **T010:** implement actor-boundary policy;
- **T011:** create the single additive role/user metadata migration;
- **T012:** make access resolution understand `ALLOW_ALL`;
- **T039:** implement `tests/integration/gate-esp020-wave1.test.ts`.

T001 is the accepted baseline. T005 is cancelled because product decisions are
already approved.

## Probable files

Inspect the repository before editing and use the smallest compatible design.
Likely files include:

- `packages/contracts/src/access-registry.ts` (new) and
  `packages/contracts/src/index.ts`;
- `packages/domain` policy modules and tests;
- `packages/database/src/schema.ts`;
- `packages/database/migrations/0052_esp020_identity_access_metadata.sql`
  (or the next repository-compatible migration name);
- `apps/api/src/identity/access.service.ts`;
- `apps/api/src/common/request-scope.ts`;
- existing permission/role contract and integration test helpers;
- `tests/integration/gate-esp020-wave1.test.ts` (new);
- focused unit tests adjacent to registry/domain/database code.

Do not modify `apps/web`, `/me`, sidebar, user administration UI, bootstrap,
`reset.ts`, auth guards, `role_permissions` seed data, or unrelated ESP code
unless a WAVE 1 test proves a minimal compatibility edit is unavoidable.

## Required design

### Canonical registry and permission lifecycle

The registry must be strict and shared by API/domain/Web consumers later. It must
provide, at minimum:

- module code, visible label, description, route, section and display order;
- action code, label and permission code;
- `systemAllowed`, `configurable` and `structural` metadata;
- actor boundary metadata;
- duplicate module/action/route validation.

Every one of the 79 currently seeded permission codes must have an explicit
status and mapping. The six historically retired codes remain documented.

- `ACTIVE`: mapped to a real module/action and consumer;
- `LEGACY`: retained only for a verified compatibility consumer;
- `ORPHAN`: persisted/observed but no current consumer;
- `RETIRED`: historical and not offered in normal UX.

Do not delete or rename permission codes. Do not expose legacy/orphan/retired
codes as normal administrator checkboxes. The registry is not itself an
authorization authority.

### Organization–role policy

Implement a typed, centralized policy using this target matrix:

| Organization | Allowed roles |
|---|---|
| MTD | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` |
| MEDICARTE | `MEDICARTE_OPERATOR`, `READ_ONLY` |
| OLP | `OLP_OPERATOR`, `READ_ONLY` |
| COMPENSAR | `COMPENSAR_VIEWER`, `READ_ONLY` |

Reject invalid new assignments before persistence/reactivation. Historical
invalid assignments must be detectable and reportable, but must not be deleted
or silently rewritten in WAVE 1. The matrix is structural product policy, not a
DB/UI configuration.

### Administrator semantics

Keep the internal role code `MTD_ADMIN`; do not add `SYSTEM_ADMIN` and do not
add `isSystemAdmin` to `users`.

Persist role metadata:

```text
roles.is_system_admin = true
roles.is_system_managed = true
```

for `MTD_ADMIN`, and expose its visible label as `Administrador`.

An active `MTD_ADMIN` assignment in active `MTD`, with an active user, resolves
to explicit `ALLOW_ALL` for registry capabilities marked `system_allowed` and
to global point access. It must not depend on manually accumulating every
`role_permissions` row. It must not bypass actor boundaries, organization
compatibility, data scope rules, or domain invariants. This wave does not
implement last-admin mutation locking.

### Provenance and migration

Create exactly one additive migration for:

- `roles.is_system_admin`;
- `roles.is_system_managed`;
- `users.provenance` using:
  `SYSTEM_BOOTSTRAP`, `TEST_FIXTURE`, `MANUAL_ADMIN_CREATED`,
  `MIGRATED_LEGACY`, `UNKNOWN`.

Existing users without deterministic evidence become `UNKNOWN`. Provenance does
not grant permissions, replace roles, or influence authorization. Do not edit
historical migrations. Do not delete or deactivate users in the migration. Do
not create a permission-lifecycle table, organization–role DB matrix, or
separate module-grant tables.

The migration must be safe for clean and existing databases, preserve current
roles/assignments/scopes/audit history, and be testable through the repository's
migrator.

### Point scope

Preserve ESP-015 exactly:

- MTD has global point scope;
- MEDICARTE uses explicit `user_point_scopes` and fails closed without a grant;
- OLP and COMPENSAR receive no point grants under this model.

Do not generalize point scopes in this wave.

## Required tests and WAVE 1 gate

Implement `tests/integration/gate-esp020-wave1.test.ts` with these 11 cases:

1. Registry compiles and rejects duplicate module/action/route codes.
2. All 79 seeded permission codes have explicit lifecycle; every `ACTIVE`
   permission is mapped.
3. `ACTIVE`, `LEGACY`, `ORPHAN` and `RETIRED` lifecycle is explicit.
4. `MTD_ADMIN` has the approved label and role metadata.
5. A newly registered `system_allowed` capability is available to admin.
6. Admin access does not require new manual `role_permissions` rows and has
   global point access.
7. Predefined/protected roles cannot become custom roles.
8. Valid organization–role assignments pass and invalid assignments fail.
9. Actor-boundary negative cases cannot escalate privileges.
10. `UNKNOWN` provenance does not alter authorization; migration is additive.
11. ESP-015 semantics remain MTD-global, MEDICARTE-explicit/fail-closed and
    OLP/COMPENSAR-without-grants.

Also add focused tests for registry schema, policy matrix, admin resolver,
provenance enum/default and migration behavior. Run the relevant existing
auth/RBAC and scope tests.

## Regression plan

Preserve and run, without weakening assertions:

- `tests/integration/gate-f1.test.ts`;
- `tests/integration/gate-f7-user-management.test.ts`;
- `tests/integration/gate-esp015.test.ts`;
- `tests/integration/gate-esp016.test.ts`;
- `tests/integration/gate-esp017.test.ts`;
- `tests/integration/gate-esp018.test.ts`;
- `tests/integration/gate-esp019.test.ts`.

Do not implement WAVE 2 tasks such as last-admin locking, bootstrap rewrite,
role/access APIs, enriched `/me`, dynamic sidebar, UX, audit transaction
changes, production reset guard, or clean-install cleanup.

## Definition of done for WAVE 1

- All exact WAVE 1 tasks are implemented or their audit evidence is refreshed.
- One additive migration is present; no historical migration is edited.
- Registry and lifecycle gates pass with zero unmapped ACTIVE permissions.
- Admin ALLOW_ALL, structural role policy, actor boundaries, provenance
  neutrality and ESP-015 semantics are proven.
- `gate-esp020-wave1.test.ts` and the required regressions pass.
- Typecheck, lint and focused package tests pass.
- No unrelated production files are changed.

## Report format

Return a report containing:

```text
BRANCH=<branch>
BASE_COMMIT=caad35a080c011137fb7c53fa6908e35fbb4d0ef
TASKS_IMPLEMENTED=T002,T003,T004,T006,T007,T008,T009,T010,T011,T012,T039
MIGRATIONS_CREATED=<list>
MIGRATIONS_EXPECTED=1
GATE_W1=PASS|FAIL
GATE_W1_CASES=11
REGRESSION_GATES=<list and result>
TEST_COMMANDS=<commands and result>
FILES_CHANGED=<list>
OPEN_TECHNICAL_ISSUES=<list or none>
WAVE_2_BLOCKED_UNTIL=WAVE_1 gate review
```

**No hagas commit hasta que la revisión humana de WAVE 1 lo autorice.**
