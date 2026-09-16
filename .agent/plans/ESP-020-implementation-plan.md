# ESP-020 — Implementation Plan

Estado: **WAVE 1 + ROLE MANAGEMENT SLICE IMPLEMENTED / REMAINDER WAVE 2+ NOT IMPLEMENTED / D01–D10 APPROVED**

Este plan se basa en:

- `.agent/specs/ESP-020-current-state-audit.md`;
- `.agent/specs/ESP-020-permission-inventory.md`;
- `.agent/specs/ESP-020-user-seed-inventory.md`;
- `.agent/specs/ESP-020-target-architecture.md`;
- `.agent/specs/ESP-020-ux-specification.md`;
- `.agent/specs/ESP-020-user-role-module-access-redesign.md`.

WAVE 1 fue implementada y verificada. El slice de administración de roles fue
implementado el 2026-09-16: APIs de roles/módulos, escritura de accesos,
concurrencia optimista, auditoría atómica y UX dedicada. El resto de WAVE 2+
permanece fuera de alcance.
D01–D10 fueron aprobadas el 2026-09-15 y `PRODUCT_DECISIONS_PENDING=0`.
El 2026-09-16 D02 fue ampliada durante la implementación para admitir roles
personalizados con scopes organizacionales, lifecycle y boundaries estructurales.

## 1. Estrategia de ejecución

La estrategia es incremental y compatible:

```text
Audit freeze
  -> registry/mapping
  -> backend invariants
  -> bootstrap/seed safety
  -> APIs/read models
  -> UX
  -> migration
  -> certification
```

Principios:

1. No iniciar UI antes de cerrar el registry y el contrato `/me`.
2. No modificar seeds existentes en una base productiva.
3. No retirar permission codes hasta tener consumer audit y compatibility plan.
4. No cambiar el significado de ESP-015.
5. Cada cambio de identidad/access debe incluir test y audit event.
6. PostgreSQL coordina concurrencia; no usar memoria como autoridad.

## 2. Impact analysis por paquete

| Área                 | Impacto esperado                                                                  | Cambio no asumido                  |
| -------------------- | --------------------------------------------------------------------------------- | ---------------------------------- |
| `apps/api`           | Identity domain service, role/access APIs, `/me`, modules, guards/policies, audit | No reemplazar auth                 |
| `apps/web`           | Registry adapter, org selector, users UX, roles UX, sidebar, forbidden            | No confiar en permisos de frontend |
| `apps/worker`        | Ninguno previsto; revisar solo si bootstrap/registry se ejecuta allí              | No modificar por proximidad        |
| `packages/domain`    | Actor boundary, role compatibility, point-access policy                           | Mantener ESP-015                   |
| `packages/contracts` | Registry y schemas de APIs/read models                                            | No incluir secretos                |
| `packages/database`  | Posible metadata/provenance migration, transactions/indexes                       | No tablas paralelas sin gap        |
| `packages/ui`        | Cards/table/toggle/drawer si faltan componentes                                   | No rediseño global                 |
| `packages/config`    | Variables de bootstrap single-admin y production guards                           | No cambiar JWT/Argon2              |
| `tests`              | Unit/API/UI/integration/concurrency/migration                                     | No reutilizar fixtures runtime     |
| Docker               | Secret/config de único admin                                                      | No hardcoded production secret     |
| Render               | Variables single-admin y runbook                                                  | Worker no cambia salvo evidencia   |
| reset/seed           | Separar clean install, dev fixtures y existing DB                                 | No delete genérico                 |
| audit                | Events de users/roles/modules/scopes                                              | No password/hash/JWT               |
| ESP-015              | Global MTD, explicit Medicarte, fail-closed                                       | No grants artificiales             |
| ESP-017/018/019      | Mantener MTD boundaries y permission behavior                                     | No cambios en reconciliation rules |

## 3. Fases

### PHASE 0 — Audit baseline (completed in planning)

Tareas: `T001–T004`. `T005` queda
`CANCELLED_BY_APPROVED_DECISION` porque D01–D10 ya fueron aprobadas.

Cerrar:

- inventario de permissions y consumers;
- módulos y rutas reales;
- organization–role matrix;
- admin strategy;
- predefined-role boundary;
- clean/install vs existing DB strategy.

Entry criteria: repositorio ESP-001…ESP-019 disponible y tests actuales verdes
o baseline documentado.

Exit criteria: ningún permission activo sin status, decisiones aprobadas
registradas y gate documental W0 aceptado.

### WAVE 1 / PHASE 1 — Foundations / Security Model

Tareas: `T002`, `T003`, `T004`, `T006–T012`, `T039`.

Construir conceptualmente:

- registry compartido;
- role/user metadata contract and one additive migration;
- action mappings;
- actor boundaries;
- organization–role compatibility;
- validators de orphan/duplicate/missing mapping.

Entry: PHASE 0 aprobada, inventory/matrix/boundaries completas y
`MIGRATIONS_EXPECTED=1`.

Exit: gate `tests/integration/gate-esp020-wave1.test.ts` verde con 11 casos,
100% de ACTIVE mapped, ALLOW_ALL/policy/provenance/ESP-015 verificados.

### PHASE 2 — Identity invariants and admin bootstrap

Tareas: `T013–T017`.

Implementar:

- identity administration domain service;
- last-admin tx/lock;
- revoke assignment concreta;
- clean bootstrap único;
- consumir la metadata/provenance y policy establecidas en WAVE 1;
- seed/fixture separation operativa.

Entry: registry/boundaries aprobados.

Exit: tests de concurrencia y clean bootstrap verdes; ninguna ruta muta
identidad fuera del servicio.

### PHASE 3 — Backend access administration

Tareas: `T018–T023`.

Implementar:

- APIs de roles/modules;
- read/write role access con optimistic concurrency;
- users API compatible;
- scope integration;
- audit transaccional;
- `/me` enriquecido.

Entry: identity invariants verdes.

Exit: backend puede administrar usuarios/access sin UI y devuelve 403 correcto.

### PHASE 4 — Dynamic navigation contract

Tareas: `T024–T026`.

Implementar:

- `/me` consumer;
- organization selector;
- sidebar registry-driven;
- direct-route forbidden.

Entry: API/read model disponible.

Exit: navegación coincide con backend en matriz de roles.

### PHASE 5 — Users and roles UX

Tareas: `T027–T032`.

Implementar:

- users list;
- create wizard;
- detail/edit;
- scopes in context;
- roles list;
- role access editor;
- protected administrator UX.

Entry: Phase 4 stable.

Exit: flows UX completos, errores, conflicts y empty states cubiertos.

### PHASE 6 — Existing database migration and compatibility

Tareas: `T033–T034`, then `T037`.

Implementar:

- migration report;
- guarded clean install;
- conservative existing-user migration;
- legacy endpoint compatibility/deprecation;
- Docker/Render/runbook.

Entry: backend and UX acceptance candidates green.

Exit: dry-run existing DB no destruye; clean DB exactly one user; rollback app
path documentado.

### PHASE 7 — Security hardening and audit certification

Tareas: `T035–T036`.

Implementar:

- audit trail APIs/UI;
- security test matrix;
- static mapping/compatibility checks;
- security review of stale legacy permissions and scope joins.

Entry: migration dry-run and UI complete.

Exit: audit evidence, no secrets, no boundary bypass.

### PHASE 8 — Integration/regression gates

Tarea: `T038`.

Ejecutar:

- clean install;
- existing DB migration;
- concurrent bootstrap/admin operations;
- all ESP-001…ESP-019 gates;
- build/deploy verification.

Entry: all prior phase gates.

Exit: Definition of Done complete.

## 4. API evolution plan

### Preserve and evolve

```text
GET    /users
POST   /users
GET    /users/:id
PATCH  /users/:id
POST   /users/:id/reset-password
PUT    /users/:id/assignments
DELETE /users/:id/assignments/:organizationId/:roleCode
```

The current DELETE endpoint by organization alone is deprecated because it can
revoke multiple active roles.

### Add

```text
GET /roles
GET /roles/:roleCode
GET /roles/:roleCode/access
PUT /roles/:roleCode/access
GET /modules
GET /users/:id/audit-events
GET /roles/:roleCode/audit-events
```

### Evolve `/me`

Additive response:

- role labels;
- `isAdministrator`;
- `accessibleModules`;
- module actions;
- point access per organization;
- optional profile version/ETag.

Keep current `permissions` array during compatibility window.

## 5. Migration plan

### Migration 1 — Role metadata and user provenance

Approved additive fields:

- `roles.is_system_admin`;
- `roles.is_system_managed`;
- `users.provenance` with approved enum values and safe `UNKNOWN` default.

No SQL is written now.

No Migration 2 is planned. Permission lifecycle is code/registry metadata;
organization–role policy is domain code; optimistic concurrency uses a
fingerprint/ETag unless implementation proves a schema version necessary.

### Data migration — Existing users

Dry-run first:

1. snapshot;
2. classify;
3. report;
4. verify admin count;
5. migrate only explicit deterministic fixture/bootstrap records;
6. preserve all real/unknown users;
7. verify scopes and audit.

### Bootstrap

Single admin config, transaction + advisory lock, no password overwrite. A
re-deploy must converge to the same user. Clean-install fixture cleanup is an
explicit classified/dry-run/confirmation flow, never a generic migration delete.

### Rollback

No destructive DB rollback. Keep old read-compatible endpoints and use forward
compensating changes for data.

## 6. Gate sequence

1. `ESP020-W0`: audit and approved-decision baseline.
2. `ESP020-W1`: `gate-esp020-wave1.test.ts` — registry, mappings, boundaries,
   admin semantics, provenance and ESP-015.
3. `ESP020-W2`: admin/last-admin/bootstrap.
4. `ESP020-W3`: backend role/user/scope APIs and `/me`.
5. `ESP020-W4`: navigation and forbidden UX.
6. `ESP020-W5`: users/roles UX.
7. `ESP020-W6`: migration/compatibility.
8. `ESP020-W7`: security/audit.
9. `ESP020-W8`: full certification.

Los criterios detallados están en `ESP-020-tasks.md`.

## 7. Definition of Ready por fase

Antes de pasar de fase:

- decisiones D01–D10 registradas como APPROVED;
- tests de fase;
- diff revisado;
- no se mezclan cleanup unrelated ni cambios de formato masivo;
- no se modifica un contrato sin consumidor actualizado;
- audit event y rollback considerados.

## 8. Definition of Done global

ESP-020 está lista cuando:

- clean install tiene exactamente un admin;
- roles existen sin usuarios demo runtime;
- admin tiene allow-all y scope global;
- last admin está protegido bajo concurrencia;
- users/roles/access son administrables;
- module registry es canónico;
- mapping de permissions está completo;
- actor boundaries no son editables por checkbox;
- ESP-015 permanece intacta;
- `/me` y sidebar son dinámicos;
- UI de users/roles está completa;
- URL/API no autorizada devuelve forbidden;
- existing users/scopes/audit se preservan;
- audit events no contienen secretos;
- tests y gates ESP-001…ESP-019 pasan;
- deployment config no crea cuentas adicionales.
