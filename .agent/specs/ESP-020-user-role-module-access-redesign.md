# ESP-020 — User, Role & Module Access Redesign

Estado: **WAVE 1 + ROLE MANAGEMENT SLICE IMPLEMENTED / REMAINDER WAVE 2+ SPECIFICATION READY / D01–D10 APPROVED**

WAVE 1 implementa el registry, policies, metadata aditiva y gate de foundations.
Las fases posteriores siguen siendo especificación; no se cambian seeds,
bootstrap, sidebar, UI ni authentication fuera del alcance de WAVE 1.

Las decisiones D01–D10 fueron aprobadas el 2026-09-15 y son definitivas salvo
contradicción técnica demostrable durante implementación.

## 1. Objective

Rediseñar la administración de usuarios, roles y accesos para que una persona
administradora entienda:

```text
Usuario → Organización → Rol → Módulos → Acciones → Data scope
```

La implementación debe reutilizar el RBAC actual, hacer explícita la semántica
de administrador y preservar:

```text
RBAC_PERMISSION AND RESOURCE_WITHIN_DATA_SCOPE
```

El objetivo de una instalación limpia es exactamente un usuario inicial:

```text
Administrador
```

Los roles existentes deben continuar existiendo aunque no tengan usuarios.

## 2. Scope

### Incluido

- auditoría y consolidación del modelo user/organization/role/permission;
- semántica explícita de administrador `ALLOW_ALL`;
- protección transaccional del último administrador;
- bootstrap idempotente de un único admin;
- separación de fixture seed, bootstrap y usuarios reales;
- module registry compartido;
- mapping permission → module/action;
- matriz de compatibilidad organization–role;
- APIs de usuarios y roles/access;
- `/me` como read model de módulos/actions/scope;
- sidebar derivado de accesos;
- UX de usuarios, roles, editor y scopes;
- eventos de auditoría;
- migración conservadora de bases existentes;
- tests de backend, frontend, integración, concurrencia y regresión.

### No incluido

- nuevo proveedor de identidad;
- cambio de JWT;
- cambio de Argon2id;
- ABAC general-purpose;
- roles por punto;
- un sistema paralelo de tablas module grants;
- SSO, OAuth social, MFA, LDAP, SCIM, IAM externo o passwordless;
- marketplace de roles;
- aprobación/JIT/temporary access;
- rediseño del modelo de negocio de organizaciones.

## 3. Current state baseline

La auditoría detallada está en
`.agent/specs/ESP-020-current-state-audit.md`. El inventario exhaustivo de
permisos está en `.agent/specs/ESP-020-permission-inventory.md`; el inventario
de cuentas está en `.agent/specs/ESP-020-user-seed-inventory.md`.

Hechos que condicionan la implementación:

1. PostgreSQL ya es fuente de verdad.
2. JWT solo identifica al usuario.
3. `role_permissions` es la relación RBAC existente.
4. `user_point_scopes` es la relación de scope de ESP-015.
5. No existe module registry.
6. No existen APIs de roles/access.
7. `MTD_ADMIN` existe como código backend.
8. Users y bootstrap actuales crean cuentas que no deben existir en clean runtime.
9. Assignments organization–role no tienen compatibility validation.
10. Last-admin check no es seguro contra mutación concurrente.

## 4. Target architecture

Referencia: `.agent/specs/ESP-020-target-architecture.md`.

### 4.1 User, organization, role, permission, module, action, scope

| Concepto        | Persistencia/autoridad target                     |
| --------------- | ------------------------------------------------- |
| User            | `users`; identidad y estado                       |
| Organization    | `organizations`; frontera tenant/actor            |
| Role            | `roles`; perfil reusable                          |
| Permission      | `permissions`; capability backend                 |
| Role assignment | `user_organization_roles`; contexto user/org/role |
| Role access     | `role_permissions`; persistencia reusable         |
| Module/action   | Registry versionado; UX mapping                   |
| Point scope     | `user_point_scopes`; resource boundary            |

### 4.2 Registry compartido

Fuente canónica recomendada:

```text
packages/contracts/src/access-registry.ts
```

Debe contener `code`, `label`, `description`, `route`, `icon`, `section`,
`displayOrder`, actions, permission mappings y actor metadata. El backend debe
validar el registry y ejecutar boundaries en API/domain. El frontend solo lo
consume para presentar y agrupar.

No se permiten catálogos divergentes en `nav-config.ts`, forms de roles y
backend permission checks.

### 4.3 Persistencia

Preferir `roles + permissions + role_permissions` existentes.

No se crean `role_module_access` o `role_module_actions` salvo que la auditoría
de implementación demuestre una brecha que no pueda representar
`role_permissions`. El registry no debe convertirse en autoridad in-memory.

El único cambio de schema previsto es metadata explícita del rol protegido y
provenance mínima de usuarios. La lifecycle de permissions vive en el registry
y no requiere una tabla adicional.

## 5. Administrator semantics

### FR-ADM-001 — Internal code

Conservar `MTD_ADMIN` para no romper consumidores. Presentarlo como
`Administrador`.

Decisión aprobada — D01=A:

```text
roles.code = MTD_ADMIN
roles.is_system_admin = true
roles.is_system_managed = true
```

No añadir `SYSTEM_ADMIN` en ESP-020 y no añadir `isSystemAdmin` a `users`.

### FR-ADM-002 — Allow all

Un role assignment activo de `MTD_ADMIN` en `MTD`, con user activo y credencial
local usable, resuelve:

- todas las acciones `system_allowed` del registry;
- todos los módulos administrativos y operativos soportados;
- `pointAccess.kind = global`;
- `isAdministrator = true`.

No necesita decenas de filas manuales por permiso. La semántica se comprueba en
backend; la UI muestra el rol como protegido.

### FR-ADM-003 — Boundaries

Allow-all no permite:

- crear una asignación inválida organization–role;
- hacer editable el rol del sistema;
- convertir un rol de actor en rol MTD;
- usar grants por punto para simular scope global;
- eludir `AccessService`, `OperationalAccessScopeService` o reglas de dominio.

### FR-ADM-004 — Last admin

Definición target de administrador activo:

```text
users.active = true
AND organization.active = true
AND user_organization_roles.active = true
AND organization.code = MTD
AND role.is_system_admin = true
AND users.password_hash IS NOT NULL
```

El sistema debe rechazar:

- desactivar el último admin;
- eliminarlo, si se incorpora delete futuro;
- revocar su última asignación admin;
- cambiar su rol de forma que pierda admin;
- autoquitarse el acceso si no existe otro admin usable;
- dejar el tenant MTD sin administrador usable.

Implementación obligatoria:

1. Todas las mutaciones pasan por un domain/identity service único.
2. La mutación y el conteo final ocurren en una misma transacción.
3. Se obtiene advisory transaction lock estable para el tenant de admin.
4. Se bloquean las filas relevantes (`FOR UPDATE`) antes de evaluar y mutar.
5. Se revalida la invariancia justo antes de commit.
6. No se usa trigger como mecanismo primario.
7. Se agregan tests concurrentes con dos mutaciones simultáneas.

PostgreSQL constraints protegen FKs, unicidad y estados; una constraint CHECK
simple no expresa “al menos un admin”. Un deferred trigger solo se considerará
si existen writers externos al servicio y después de medir esa necesidad.

## 6. Clean install and bootstrap

### FR-BS-001 — Exactly one initial user

Después de una instalación limpia y bootstrap:

- `COUNT(users) = 1`;
- esa fila es admin activo;
- roles y permisos existen sin usuarios adicionales;
- no existen cuentas runtime `OLP`, `MEDICARTE`, `MTD_GENERAL`,
  `MTD_AUDITORIA`, `READ_ONLY` o similares.

### FR-BS-002 — Configuration

Evaluar nombres equivalentes a:

```text
ADMIN_USERNAME
ADMIN_INITIAL_PASSWORD
ADMIN_NAME
ADMIN_EMAIL
```

La implementación debe reconciliarse con
`AUTH_BOOTSTRAP_ADMIN_USERNAME/PASSWORD` existentes. No debe mantener variables
para bootstrap automático de `mtd-general` y `mtd-auditoria`.

### FR-BS-003 — Safety

Bootstrap:

- idempotente;
- no sobrescribe password existente;
- no tiene credenciales hardcoded;
- no imprime password/hash/JWT;
- usa la misma transacción y lock ante múltiples instancias;
- no crea un admin adicional si ya existe uno;
- puede recuperarse ante redeploy;
- audita `ADMIN_BOOTSTRAPPED` sin secretos.

### FR-BS-004 — Existing database

No se ejecuta cleanup destructivo global. El camino forward-compatible de
instalación/reconciliación debe:

- detectar instalación limpia de forma demostrable;
- preservar cualquier user no clasificado;
- emitir reporte para fixture candidates;
- permitir `MANUAL_REVIEW` antes de desactivar o migrar cuentas.

## 7. Role model and boundaries

### FR-ROLE-001 — Predefined roles

ESP-020 mantiene los roles internos actuales. Labels target:

| Internal             | Visible            |
| -------------------- | ------------------ |
| `MTD_ADMIN`          | Administrador      |
| `MTD_OPERATOR`       | Operador MTD       |
| `MTD_GENERAL`        | MTD General        |
| `MTD_AUDITORIA`      | Auditoría MTD      |
| `READ_ONLY`          | Solo lectura       |
| `MEDICARTE_OPERATOR` | Operador Medicarte |
| `OLP_OPERATOR`       | Operador OLP       |
| `COMPENSAR_VIEWER`   | Consulta Compensar |

### FR-ROLE-002 — Assignment compatibility

Definir y validar matriz organization–role antes de persistir:

| Organization | Allowed roles target                                                     |
| ------------ | ------------------------------------------------------------------------ |
| MTD          | `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`, `READ_ONLY` |
| MEDICARTE    | `MEDICARTE_OPERATOR`, `READ_ONLY`                                        |
| OLP          | `OLP_OPERATOR`, `READ_ONLY`                                              |
| COMPENSAR    | `COMPENSAR_VIEWER`, `READ_ONLY`                                          |

Asignaciones históricas incompatibles no se borran automáticamente; se reportan
y quedan bloqueadas para nuevas operaciones hasta decisión/migración.

### FR-ROLE-003 — Custom roles

Decisión actualizada el 2026-09-16: se permiten roles personalizados con código
generado por el backend, nombre editable, lifecycle activo/inactivo y uno o más
scopes organizacionales explícitos. No pueden declararse administradores del
sistema, editar boundaries ni recibir capabilities estructurales.

La creación, actualización, desactivación y asignación de permisos se audita de
forma atómica. Un rol inactivo no puede recibir nuevas asignaciones y sus
asignaciones activas se revocan dentro de la misma transacción.

### FR-ROLE-004 — Protected capabilities

El role editor no puede cambiar capabilities estructurales:

- `users.manage`;
- admin allow-all;
- role/access administration;
- point scope management;
- MTD reconciliation;
- tariff/financial boundaries;
- actor-specific restrictions;
- state-machine/domain invariants.

El admin puede configurar capabilities declaradas `configurable=true` dentro de
la matriz compatible.

## 8. Module/action access

### FR-MOD-001 — Registry

El registro debe cubrir cada ruta autorizada real y cada permission activo
consumido por backend. Debe marcar:

- `system_allowed`;
- `configurable`;
- `structural`;
- actor boundary;
- `permissionMappings`.

El inventario obligatorio está en
`.agent/specs/ESP-020-permission-inventory.md`.

### FR-MOD-002 — Mapping completeness

No se puede habilitar el role editor hasta tener:

- 100% de permission codes activos clasificados;
- 0 permissions backend usados sin mapping;
- 0 module/action mapping que no tenga permission real;
- lista explícita de legacy/retired/orphan;
- decisión para cada `view.*`.

### FR-MOD-003 — Module matrix

La UI muestra:

```text
Módulo
  Acceso
  Acciones
```

No muestra una lista plana de permission codes en el flujo normal.

### FR-MOD-004 — Scope separation

La matriz module/action responde “qué puede hacer”. La pantalla scope responde
“sobre qué puntos puede hacerlo”. Nunca se sustituyen.

## 9. Backend/API requirements

La evolución debe preferir compatibilidad sobre duplicación.

### 9.1 Existing endpoints to evolve

Conservar rutas actuales mientras los clientes migren:

```text
GET    /users
POST   /users
GET    /users/:id             (nuevo)
PATCH  /users/:id
POST   /users/:id/reset-password
PUT    /users/:id/assignments
DELETE /users/:id/assignments/:organizationId/:roleCode
```

La ruta DELETE actual por solo `organizationId` debe deprecarse y dejar de
revocar todos los roles. El backend debe identificar una asignación concreta.

### 9.2 Target role/access endpoints

```text
GET /roles
GET /roles/:roleCode
GET /roles/:roleCode/access
PUT /roles/:roleCode/access
GET /modules
```

`PUT /roles/:roleCode/access` debe incluir versión/ETag y rechazar:

- role admin protegido;
- capability estructural;
- module/action fuera de actor boundary;
- permission inexistente;
- write sin `users.manage`/capability administrativa equivalente.

### 9.3 Target `/me`

Conservar `GET /me` y añadir un read model compatible:

- user identity;
- `mustChangePassword`;
- `isAdministrator`;
- organizations activas;
- roles con code/label;
- permissions para compatibilidad;
- `accessibleModules` con actions;
- point access por organización;
- sin secretos.

La API debe volver a calcularlo desde PostgreSQL. El frontend no puede enviar
`accessibleModules` como autoridad.

### 9.4 Audit trail endpoint

Evaluar/añadir:

```text
GET /users/:id/audit-events
GET /roles/:roleCode/audit-events
```

La visibilidad requiere permiso administrativo y respeta organización.

## 10. Frontend requirements

Referencia implementable:
`.agent/specs/ESP-020-ux-specification.md`.

Debe incluir:

- users list;
- create user en tres pasos;
- user detail/edit;
- role list;
- role access editor;
- protected admin role UI;
- active organization selector;
- dynamic grouped sidebar;
- empty/loading/error states;
- 403 state;
- last-admin messages;
- global point access representation.

Los datos de forms y navegación dejan de estar hardcoded en
`apps/web/features/admin/users-admin.tsx` y `nav-config.ts`; se consumen del
contract/read model.

## 11. Audit requirements

Eventos target:

```text
USER_CREATED
USER_UPDATED
USER_ENABLED
USER_DISABLED
USER_ROLE_CHANGED
ROLE_CREATED
ROLE_UPDATED
ROLE_MODULE_ACCESS_CHANGED
ROLE_PERMISSION_CHANGED
USER_POINT_SCOPE_CHANGED
ADMIN_BOOTSTRAPPED
```

Los scopes existentes conservan:

```text
OPERATIONAL_POINT_SCOPE_GRANTED
OPERATIONAL_POINT_SCOPE_REVOKED
OPERATIONAL_POINT_SCOPE_REPLACED
```

Metadata permitida:

- actor ID;
- organization ID;
- user/role/module/action IDs o codes;
- before/after de access flags;
- correlation/request ID;
- motivo;
- version.

Prohibido:

- password;
- password hash;
- JWT;
- secret;
- token;
- password temporal.

Las mutaciones user/role/access y su audit deben ser atómicas para no confirmar
un cambio sin evidencia. Login sigue pudiendo ignorar fallo de audit como está
documentado en `AuthService`.

## 12. Migration strategy

### Clean install

Camino recomendado:

1. roles y permissions se siembran;
2. usuarios fixture históricos no se insertan en el camino runtime o se
   clasifican únicamente en un flow de instalación limpia con evidencia;
3. bootstrap crea un admin;
4. se valida `COUNT(users)=1`;
5. se ejecutan gates clean install.

### Existing database

1. snapshot de users/assignments/scopes/audit;
2. clasificación fixture determinista;
3. preservación por default;
4. migración de admin existente, sin sustituirlo automáticamente;
5. validación de role compatibility;
6. reporte de asignaciones inválidas;
7. no backfill artificial de point scopes;
8. verificación de que al menos un admin usable queda activo;
9. switch de app después de verificar.

### Rollback

- rollback de app: mantener endpoints legacy read-compatible;
- rollback de UI: el backend nuevo sigue protegiendo;
- no hacer rollback destructivo de datos;
- no eliminar audit history;
- revertir flags de acceso solo con migration forward/compensating action;
- mantener scopes históricos.

## 13. Database impact

Decisiones aprobadas:

- reutilizar `role_permissions`;
- no crear tablas module access sin gap probado;
- una migration aditiva para `roles.is_system_admin`,
  `roles.is_system_managed` y provenance de `users`;
- lifecycle de permissions en registry/código, sin persistencia adicional;
- compatibility organization–role en policy de domain, sin matriz configurable
  en DB;
- optimistic concurrency mediante fingerprint/ETag calculado, sin columna de
  versión adicional salvo evidencia técnica posterior.

`MIGRATIONS_EXPECTED=1`: migration forward-compatible de metadata de roles y
provenance de usuarios, con default/backfill seguro `UNKNOWN`. No se edita
ninguna migration histórica y no se ejecuta cleanup destructivo dentro de ella.
El clean install usa un camino explícito con dry-run/confirmación cuando aplique.

## 14. Security invariants

1. Backend es autoridad.
2. JWT no es autoridad de permisos.
3. Ocultar módulo no concede seguridad.
4. Toda mutación de admin/access exige permission administrativo.
5. Organization boundary se evalúa antes de datos.
6. Actor boundary no es configurable por checkbox.
7. Point scope se evalúa después de RBAC.
8. `MTD_ADMIN` global no usa grants artificiales.
9. Medicarte sin grant activo queda fail-closed.
10. Transfers requieren source y destination dentro del scope.
11. Un usuario desactivado pierde acceso inmediatamente.
12. Último admin no puede quedar inutilizable.
13. Role admin protegido no puede perder allow-all por UI.
14. Audits no contienen secretos.
15. No hay authority en memoria, Redis o frontend.

## 15. Acceptance criteria

### Bootstrap

- clean DB produce exactamente un user;
- user es Administrador activo;
- redeploy conserva uno;
- password no se sobreescribe;
- dos bootstraps concurrentes producen uno;
- no hay passwords/log secrets.

### Administrator

- admin accede a todos los módulos target;
- admin accede a todas las actions `system_allowed`;
- admin tiene scope global;
- admin no puede auto-lockout;
- último admin no se desactiva, elimina ni pierde role;
- admin role UI es read-only.

### Users

- crear, editar, activar/desactivar y reset seguro;
- asignar roles compatibles;
- revocar una asignación concreta;
- mostrar last access;
- gestionar scope cuando aplica;
- conservar usuarios reales en migration.

### Role access

- roles list y counts;
- editor module→actions;
- crear y desactivar roles personalizados con scopes organizacionales;
- shortcut seguro;
- conflict detection;
- no structural boundary bypass;
- custom roles no pueden convertirse en administradores ni editar boundaries.

### Navigation

- `/me` entrega modules/actions;
- sidebar agrupa registry;
- módulo no autorizado no aparece;
- sección vacía no aparece;
- URL directa llega a forbidden;
- API directa devuelve 403.

### ESP-015

- `RBAC_PERMISSION AND RESOURCE_WITHIN_DATA_SCOPE` permanece;
- Medicarte sin points no opera;
- MTD no necesita grants por punto;
- grants revocados permanecen en history;
- mutations críticas conservan revalidación transaccional.

### Audit and regression

- todos los eventos de identidad/access requeridos;
- metadata sin secretos;
- unit/lint/typecheck/build;
- integration gates ESP-001…ESP-019 verdes;
- nuevos tests de concurrencia y migration verdes.

## 16. Approved product decisions

Estas decisiones fueron aprobadas el 2026-09-15 y bloquean el baseline de
implementación:

| ID    | Decision                  | Options                                                   | Recommendation                                                   | Impact                                    |
| ----- | ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| D-001 | Admin identity            | conservar `MTD_ADMIN`; crear `SYSTEM_ADMIN`; flag en user | **APPROVED:** `MTD_ADMIN` + flags en role + `ALLOW_ALL`          | Schema metadata, compatibility, allow-all |
| D-002 | Custom roles              | predefinidos; custom ahora                                | **APPROVED:** solo predefinidos en ESP-020                       | Reduce RBAC/migration scope               |
| D-003 | Organization–role matrix  | libre; hardcoded policy; DB matrix                        | **APPROVED:** policy canónica en domain                          | Actor boundaries                          |
| D-004 | Multi-organization UX     | selector; ruta; prohibir multi-org                        | **APPROVED:** selector explícito                                 | `/me`, web context, headers               |
| D-005 | Legacy permissions        | eliminar; deprecar; mantener mapping                      | **APPROVED:** clasificar, no eliminar destructivamente           | Permission registry                       |
| D-006 | User provenance           | no provenance; column/event; external report              | **APPROVED:** columna mínima + clasificación conservadora        | Seed/migration                            |
| D-007 | Point scope organizations | solo Medicarte; todas; role-specific                      | **APPROVED:** solo MEDICARTE; preservar ESP-015                  | Scope service and APIs                    |
| D-008 | Audit atomicity           | best effort; same tx                                      | **APPROVED:** misma tx para identity/access; login razonable     | Services/transactions                     |
| D-009 | Reset production          | flag; no change                                           | **APPROVED:** bloquear production                                | Operational safety                        |
| D-010 | Clean migration mechanism | editar baseline; guarded cleanup; new baseline            | **APPROVED:** no editar applied migrations; clean path explícito | Migration/ops                             |

`DECISIONS_REQUIRING_PRODUCT_CONFIRMATION=0`.

## 17. Out of scope

Quedan explícitamente fuera salvo una decisión posterior:

- SSO;
- OAuth social;
- MFA;
- LDAP;
- SCIM;
- IAM externo;
- passwordless;
- marketplace de custom roles;
- approval workflow de user creation;
- temporary/JIT access;
- ABAC general-purpose;
- reemplazar JWT;
- reemplazar Argon2id;
- rediseñar organizations;
- reescribir la lógica de negocio de ESP-001…ESP-019;
- convertir scopes en permissions;
- dar acceso de actor cruzado por configuración.
