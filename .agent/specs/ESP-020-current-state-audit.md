# ESP-020 — Current State Audit

Estado: **AUDITADO / D01–D10 APPROVED / ESP-020 NO IMPLEMENTADA**
Fecha del audit: 2026-09-15
Alcance: repositorio hasta la migración `0051_esp019_reconciliation_operations.sql`.

Este documento registra hechos observables en el repositorio y las decisiones
aprobadas para ESP-020. Las decisiones aprobadas se incorporan como baseline de
implementación; no habilitan cambios productivos durante esta fase.

## 1. Resumen ejecutivo

La arquitectura actual ya tiene una base RBAC multi-organización y una segunda
dimensión de autorización por punto de dispensación:

```text
users
  -> user_organization_roles
      -> organizations
      -> roles
          -> role_permissions
              -> permissions

users
  -> user_point_scopes
      -> dispensing_points
```

ESP-015 define explícitamente:

```text
RBAC_PERMISSION AND RESOURCE_WITHIN_DATA_SCOPE
```

La API resuelve roles y permisos frescos desde PostgreSQL en cada request; el JWT
no contiene permisos y el frontend no es frontera de seguridad.

Los gaps principales para ESP-020 son:

1. No existe un registro compartido de módulos, acciones y mappings.
2. No existen APIs de administración de roles, permisos o módulos.
3. La UI de usuarios mezcla alta, asignaciones, passwords y scopes en una sola
   pantalla y usa catálogos hardcoded.
4. El frontend representa `MTD_ADMIN` y `MTD_OPERATOR` como la meta-categoría
   `MTD`; además, muestra `MTD_OPERATOR` con el label de administrador.
5. La API permite asignar cualquier rol a cualquier organización.
6. La revocación actual recibe solo `organizationId` y desactiva todos los roles
   activos del usuario en esa organización.
7. La comprobación de último administrador no está protegida por una transacción
   con lock contra dos mutaciones concurrentes.
8. Las migraciones iniciales insertan usuarios fixture y el bootstrap puede crear
   tres cuentas locales.
9. `/me` devuelve permisos y scopes por organización, pero no módulos accesibles,
   acciones, `isAdministrator` ni una organización activa seleccionada.
10. No hay provenance explícito para distinguir usuarios fixture, bootstrap y
    usuarios reales en una base existente.

## 1.1 Decisiones aprobadas

Con fecha 2026-09-15, las decisiones D01–D10 quedan aprobadas:

```text
D01=A  MTD_ADMIN + role metadata + ALLOW_ALL
D02=A  Solo roles predefinidos
D03=B  Policy organización–rol en domain
D04=A  Selector explícito multi-organización
D05=B  Legacy permissions clasificados/deprecados
D06=B  Provenance mínima persistida
D07=A  Point scopes explícitos solo para MEDICARTE
D08=B  Audit atómico para identity/access
D09=A  reset.ts bloqueado en production
D10=B  Clean path forward-compatible y migración conservadora
```

## 2. Topología del repositorio

| Área | Evidencia | Responsabilidad actual |
|---|---|---|
| API | `apps/api` | NestJS, autenticación, guards, identidad, RBAC, scopes y módulos operativos |
| Web | `apps/web` | Next.js, rutas, navegación, contexto de sesión y administración actual |
| Worker | `apps/worker` | BullMQ/outbox y operaciones asíncronas |
| Database | `packages/database` | Drizzle, PostgreSQL, migraciones, reset |
| Contracts | `packages/contracts` | Schemas Zod y tipos compartidos |
| Domain | `packages/domain` | Políticas de scope, estados e invariantes de dominio |
| UI | `packages/ui` | Componentes compartidos |
| Config | `packages/config` | Validación de variables de entorno |
| Tests | `tests/integration` | Gates F1, ESP-001…ESP-019 y gestión de usuarios |

No existe una especificación o implementación ESP-020 en el repositorio.

## 3. Modelo actual de identidad

### 3.1 `users`

Definición: `packages/database/src/schema.ts:34-61`; base histórica:
`packages/database/migrations/0000_foundation.sql:9-17`; evolución local:
`packages/database/migrations/0013_local_auth.sql`.

Campos relevantes:

- `id`.
- `username`, normalizado a minúsculas y único case-insensitive.
- `email`, opcional y no identificador de login.
- `display_name`.
- `password_hash`, Argon2id, nullable para usuarios heredados sin credencial local.
- `must_change_password`.
- `password_changed_at`.
- `last_login_at`.
- `active`.
- `created_at`, `updated_at`.
- `oidc_subject`, nullable/deprecado; ya no autentica.

No existen:

- `provenance` u `origin`;
- `deleted_at`;
- `deleted_by`;
- `last_disabled_reason`;
- estado de invitación;
- relación a un creador;
- expiración de cuenta;
- indicador de administrador en `users`.

La ausencia de provenance impide clasificar automáticamente todos los usuarios
existentes. Los usuarios de migración pueden identificarse con evidencia fuerte
por IDs/subjects/emails estáticos, pero no debe generalizarse esa heurística a
usuarios reales.

### 3.2 `organizations`

Definición: `packages/database/src/schema.ts:25-32`.

Campos: `id`, `code`, `name`, `drive_url`, `active`, `created_at`.

La migración foundation inserta:

| Código | Nombre actual | Evidencia |
|---|---|---|
| `MTD` | MTD | `0000_foundation.sql:117-121` |
| `COMPENSAR` | Compensar | `0000_foundation.sql:117-121` |
| `OLP` | OLP | `0000_foundation.sql:117-121` |
| `MEDICARTE` | Medicarte | `0000_foundation.sql:117-121` |

No existe una tabla de compatibilidad organización–rol.

### 3.3 Roles

Definición: `packages/database/src/schema.ts:63-67`.

La base actual contiene estos códigos:

| Código | Nombre sembrado | Observación |
|---|---|---|
| `MTD_ADMIN` | MTD administrator | Rol administrativo MTD actual |
| `MTD_OPERATOR` | MTD operator | Rol operativo MTD |
| `COMPENSAR_VIEWER` | Compensar viewer | Consulta histórica/organizacional |
| `OLP_OPERATOR` | OLP operator | Operación OLP |
| `MEDICARTE_OPERATOR` | Medicarte operator | Operación Medicarte |
| `READ_ONLY` | Read only | Rol transversal, condicionado por organización |
| `MTD_GENERAL` | MTD General | Añadido en `0019_rbac_profiles.sql` |
| `MTD_AUDITORIA` | MTD Auditoría | Añadido en `0019_rbac_profiles.sql` |

Los roles son globales, no tienen `organization_id`, `active`,
`is_system_admin`, `is_editable` ni metadata de actor. Un usuario puede tener
múltiples roles activos en una misma organización porque la PK de
`user_organization_roles` es `(user_id, organization_id, role_id)`.

La interfaz frontend no usa los mismos códigos. En
`apps/web/components/navigation/nav-config.ts:1-28` aparecen `MTD`, `OLP`,
`MEDICARTE`, `COMPENSAR`, etc. `apps/web/components/layout/role-context.tsx:48-63`
convierte `MTD_ADMIN` y `MTD_OPERATOR` en la meta-categoría `MTD`.

Esto produce una inconsistencia comprobable: `ROLE_META.MTD` tiene label
`MTD Admin`, por lo que un `MTD_OPERATOR` puede presentarse como administrador.

**APPROVED — D01/D02:** `MTD` no será un rol backend nuevo. Se conservan los
códigos internos y se elimina la traducción semánticamente ambigua mediante un
registro canónico. `MTD_ADMIN` se presenta como `Administrador`; los roles serán
predefinidos.

### 3.4 Asignaciones usuario–organización–rol

Definición: `packages/database/src/schema.ts:90-111`.

Características:

- PK compuesta `(user_id, organization_id, role_id)`.
- `active` boolean.
- `created_at`.
- FKs restrictivas a users, organizations y roles.
- Sin `revoked_at`, `revoked_by`, `reason`, `version` o `updated_at`.

`UsersService.create()` y `addAssignment()` validan que organización y rol
existan, pero no validan compatibilidad entre ambos:
`apps/api/src/identity/users.service.ts:175-193` y `329-356`.

Ejemplos actualmente permitidos por la API, aunque probablemente inválidos por
actor:

- `MTD_ADMIN` en `MEDICARTE`.
- `MEDICARTE_OPERATOR` en `MTD`.
- `OLP_OPERATOR` en `COMPENSAR`.
- `MTD_GENERAL` en una organización distinta de `MTD`.

Esto es un gap de seguridad porque la política de scopes depende de combinación
de organización y roles.

## 4. Modelo actual de permisos y RBAC

### 4.1 Persistencia

Definiciones:

- `permissions`: `packages/database/src/schema.ts:69-73`.
- `role_permissions`: `packages/database/src/schema.ts:75-88`.

`permissions` contiene código único y descripción. `role_permissions` es una
relación global role–permission; no tiene `active`, versión, módulo, acción,
actor boundary ni indicador de asignabilidad.

No existe un sistema paralelo de grants por módulo. La base existente es
suficiente para representar el acceso si se añade un catálogo de metadata y se
reutiliza `role_permissions`.

### 4.2 Resolución en backend

`apps/api/src/identity/access.service.ts:28-130`:

- hace join de user, organización, roles, role_permissions y permissions;
- agrupa roles y permisos por organización;
- consulta `user_point_scopes` por usuario;
- devuelve perfil fresco desde PostgreSQL;
- `requirePermission()` exige `X-Organization-Id`;
- niega si el permiso no está en la organización solicitada.

`apps/api/src/common/auth.guard.ts:16-69` verifica el JWT y vuelve a comprobar que
el usuario exista y esté activo en PostgreSQL. Cambiar `active` o roles tiene
efecto inmediato sobre requests posteriores.

### 4.3 Administrador actual

El código interno actual es `MTD_ADMIN`. La migración
`0010_mtd_admin_full_access.sql` asigna todos los permisos existentes en ese
momento y varias migraciones posteriores asignan explícitamente permisos nuevos.

`Scope.isFoundationAdmin` se deriva de si la organización actual contiene
`MTD_ADMIN`: `apps/api/src/common/request-scope.ts:37-48`.

No existe semántica de `ALLOW ALL`; el acceso completo depende de filas
`role_permissions` acumuladas. Esto es frágil para futuros permisos.

## 5. Point scopes y ESP-015

Fuente normativa: `.agent/adr/ADR-038-esp-015-organization-point-access.md`.

Persistencia:

- `user_point_scopes` en `0047_esp015_point_scopes.sql`.
- Grants activos únicos por `(user_id, dispensing_point_id)`.
- Grants revocados se conservan.
- No se crean roles por punto.

Semántica vigente:

| Actor | `pointAccess.kind` | Regla |
|---|---|---|
| Roles MTD en organización MTD | `global` | No requiere grants artificiales |
| `MEDICARTE_OPERATOR` en MEDICARTE | `explicit` | Sin grant = cero puntos |
| OLP/Compensar | `unrestricted` | Su frontera no se modela con puntos |

Servicio central: `apps/api/src/access-scopes/operational-access-scope.service.ts`.
Helpers transaccionales: `apps/api/src/common/point-scope.sql.ts`.

La mutación de scopes sí usa transacción, locking de grants y auditoría dentro de
la transacción. Sin embargo, existen gaps que ESP-020 debe reconocer:

- UUID `MEDICARTE` hardcoded en `operational-access-scope.service.ts:27`.
- `loadEligibleUserOn()` busca cualquier rol `MEDICARTE_OPERATOR` para
  elegibilidad, pero no exige que el rol pertenezca a la organización
  `MEDICARTE`.
- La matriz de actor–organización no está validada antes de calcular el scope.
- `/me` obtiene grants por usuario y luego los puede reutilizar para cualquier
  organización con scope explícito.

ESP-020 no debe cambiar la fórmula ni introducir grants para representar acceso
global del administrador.

## 6. Autenticación

Evidencia:

- `apps/api/src/identity/auth.service.ts`.
- `apps/api/src/identity/jwt.ts`.
- `apps/api/src/identity/password.ts`.
- `packages/database/migrations/0013_local_auth.sql`.

Estado actual:

- Password local en PostgreSQL.
- Argon2id mediante `hash-wasm`.
- JWT HS256; el JWT identifica al usuario, no contiene permisos.
- TTL default de 8 horas.
- `sessionStorage` en web.
- Sin refresh token.
- Dummy Argon2id para usuarios inexistentes o sin password.
- Throttle por IP/username en el flujo de login.
- `must_change_password` bloquea la interfaz hasta cambio de password.

ESP-020 no requiere reemplazar JWT, Argon2id ni el flujo de autenticación. Solo
debe tocarlo para el bootstrap inicial y para no imprimir secretos.

## 7. Bootstrap, migrations, Docker, Render y reset

### 7.1 Usuarios insertados por migrations

`0000_foundation.sql:171-180` inserta:

- `admin@example.test`, inicialmente `Foundation Admin`, activo, MTD/`MTD_ADMIN`
  y OLP/`READ_ONLY`.
- `olp@example.test`, activo, OLP/`OLP_OPERATOR`.
- `suspended@example.test`, inactivo, MTD/`READ_ONLY`.

`0005_phase4_operational_notifications.sql:173-178` añade:

- `medicarte@example.test`, activo, MEDICARTE/`MEDICARTE_OPERATOR`.

`0013_local_auth.sql` conserva los IDs y crea usernames derivados, pero deja
`password_hash` nullable. Esas cuentas no son credenciales locales utilizables
hasta reset o bootstrap.

### 7.2 Bootstrap de API

`apps/api/src/identity/bootstrap.service.ts:27-130` puede crear o recuperar:

- username configurable para `MTD_ADMIN`;
- `mtd-general` con `MTD_GENERAL`;
- `mtd-auditoria` con `MTD_AUDITORIA`.

Solo actúa si existe password en la configuración. Usa
`pg_advisory_xact_lock`, transacción y no sobrescribe un `password_hash`
existente.

La implementación ya tiene buenas propiedades de idempotencia, pero el objetivo
ESP-020 exige que el único target runtime sea el administrador. Las cuentas
generales/auditoría deben dejar de ser targets de bootstrap.

### 7.3 Docker y Render

`docker-compose.yml:52-76` define `foundation-admin` con password hardcoded
para desarrollo local. `render.yaml:48-59` usa password secreta para admin, pero
también contempla passwords opcionales para `mtd-general` y `mtd-auditoria`.

No debe extrapolarse el comportamiento local/demo a producción.

### 7.4 Reset

`packages/database/src/reset.ts:11-108` preserva organizaciones, usuarios,
roles, permissions, role_permissions y user_organization_roles; trunca
`user_point_scopes`, `audit_events` y tablas operativas. Exige `--yes`, pero no
bloquea explícitamente `NODE_ENV=production`.

**APPROVED — D09:** `reset.ts` quedará bloqueado cuando `NODE_ENV=production`.
No habrá bypass mediante `--yes`, variable adicional o doble confirmación dentro
de ESP-020. Un mecanismo operativo futuro deberá definirse aparte.

## 8. API existente

### Identidad y usuarios

`apps/api/src/identity/users.controller.ts`:

| Método | Ruta | Permiso | Estado |
|---|---|---|---|
| GET | `/users` | `users.manage` | Lista todos los usuarios; filtro `active` |
| POST | `/users` | `users.manage` | Crea usuario y una asignación |
| PATCH | `/users/:id` | `users.manage` | Cambia display name/active |
| POST | `/users/:id/reset-password` | `users.manage` | Reset administrativo |
| PUT | `/users/:id/assignments` | `users.manage` | Añade/reactiva asignación |
| DELETE | `/users/:id/assignments/:organizationId` | `users.manage` | Revoca todos los roles de organización |

No existe GET de detalle dedicado, endpoint de roles, endpoint de permisos,
endpoint de módulos, endpoint de acceso de rol ni endpoint de audit trail por
usuario.

### Scopes

`apps/api/src/access-scopes/access-scope.controller.ts`:

- `GET /access-scopes/assignable-points`.
- `GET /access-scopes/users/:userId/points`.
- `PUT /access-scopes/users/:userId/points`.

Se preservan y evolucionan; no se reemplazan por una matriz de módulos.

### `/me`

`apps/api/src/identity/me.controller.ts` y `packages/contracts/src/index.ts:82-98`
exponen:

- identidad;
- `mustChangePassword`;
- organizaciones activas;
- roles por organización;
- permisos por organización;
- `pointAccess.kind`;
- `accessiblePointIds`.

No exponen:

- label/descripción de roles;
- módulos accesibles;
- acciones agrupadas;
- `isAdministrator`;
- versión del perfil;
- organización activa del cliente.

Además, los puntos se consultan globalmente por usuario y no están ligados
directamente a organización en `user_point_scopes`.

## 9. Frontend actual

### 9.1 Navegación

`apps/web/components/navigation/nav-config.ts:65-222` contiene una única
sección `Plataforma` con todos los elementos. Cada item mezcla:

- `view`;
- ruta;
- label;
- icon;
- roles frontend;
- un permiso opcional.

`apps/web/components/layout/sidebar.tsx:23-47` filtra con
`hasPermission()` y roles derivados.

La navegación actual contiene rutas reales para:

`/`, `/periodos`, `/programacion`, `/demanda`, `/ordenes-compra`,
`/logistica-olp`, `/entregas-olp`, `/entregas`, `/recepciones`, `/inventario`,
`/traslados`, `/aplicaciones`, `/resultados-operacionales`, `/auditorias`,
`/indicadores`, `/importaciones`, `/integridad`, `/administracion`.

El administrador y los scopes comparten `/administracion`; no existe ruta
`/administracion/roles`.

### 9.2 Protección de rutas

`apps/web/components/layout/app-shell.tsx:22-39` redirige a
`/acceso-denegado` si el item conocido no corresponde al rol o permiso.
`apps/web/app/acceso-denegado/page.tsx` muestra un estado mínimo.

La protección frontend no sustituye la API. Los controllers usan `AuthGuard` y
`AccessService.requirePermission()`.

### 9.3 Organización activa

`role-context.tsx:220-237` elige una organización automáticamente por prioridad
de roles. No existe selector de organización activa.

Un usuario con varias organizaciones puede recibir un perfil completo en `/me`,
pero la UI selecciona una organización implícitamente y usa ese ID en
`X-Organization-Id`.

**APPROVED — D04:** se preservan usuarios multi-organización y se implementará
un selector explícito de organización activa. La organización no se moverá a la
URL ni se prohibirán asignaciones múltiples.

### 9.4 Administración actual

`apps/web/features/admin/administracion-view.tsx` compone:

- `UsersAdminSection`;
- `OperationalScopesSection`.

`apps/web/features/admin/users-admin.tsx`:

- mantiene organizaciones hardcoded;
- mantiene roles hardcoded;
- muestra usuarios, asignaciones, estado y acciones;
- crea con password en el mismo formulario;
- restablece password desde la misma tarjeta;
- no muestra último acceso en tabla;
- no muestra audit trail;
- permite seleccionar combinaciones organización–rol inválidas;
- muestra un botón por asignación, pero llama a un endpoint que solo recibe
  organización y puede revocar todos los roles de esa organización.

## 10. Auditoría

Tabla: `audit_events`, `packages/database/migrations/0000_foundation.sql:46-73`.

Características:

- append-only;
- triggers bloquean UPDATE/DELETE;
- actor, organización, acción, recurso, before/after, correlation ID,
  request ID, IP, user-agent y resultado.

Ya existen eventos de login, password, usuarios, roles, scopes y dominios
operativos. `UsersService` modifica algunas filas y audita después, en otra
operación de conexión (`users.service.ts:55-75`, `227-231`, `289-299`, etc.).
Si el audit falla, el cambio puede quedar persistido sin evidencia atómica.

La mutación de scopes sí audita dentro de la misma transacción.

ESP-020 debe añadir los eventos de role/module access solicitados, sin secretos:
password, hash, JWT y secretos nunca deben aparecer en metadata.

## 11. Tests actuales

Gates relevantes:

- `tests/integration/gate-f1.test.ts`.
- `tests/integration/gate-f7-user-management.test.ts`.
- `tests/integration/gate-esp015.test.ts`.
- `tests/integration/gate-esp017.test.ts`.
- `tests/integration/gate-esp018.test.ts`.
- `tests/integration/gate-esp019.test.ts`.

`gate-f7-user-management.test.ts` cubre alta, password, multi-asignación,
desactivación, revocación, auto-desactivación y último admin en escenarios
secuenciales.

Faltan pruebas dedicadas de:

- carrera concurrente de último administrador;
- compatibilidad organización–rol;
- revocación de un role específico cuando hay varios roles;
- allow-all semántico de administrador;
- módulo/action mapping completo;
- API de edición de roles;
- sidebar derivado desde módulos;
- selector de organización;
- provenance y clasificación de cuentas;
- dos bootstrap simultáneos en el mismo escenario real;
- contrato enriquecido de `/me`.

## 12. Gaps y deuda técnica relevante

| ID | Gap | Riesgo ESP-020 | Evidencia |
|---|---|---|---|
| G-001 | Sin module registry | UI y backend divergen | `nav-config.ts`, migrations |
| G-002 | Roles globales sin metadata | No hay semántica de admin protegida | `schema.ts:63-67` |
| G-003 | Asignación libre organización–rol | Escalamiento/alcance incorrecto | `users.service.ts:175-193` |
| G-004 | Revocación por organización | Puede retirar más accesos de los vistos | `users.service.ts:368-402` |
| G-005 | Último admin no transaccional | Lockout bajo concurrencia | `users.service.ts:152-172`, `258-274` |
| G-006 | Seeds fixture en migrations | Clean install > 1 usuario | `0000`, `0005` |
| G-007 | Bootstrap con tres targets | Cuentas runtime adicionales | `bootstrap.service.ts:27-50` |
| G-008 | Sin provenance | Migración destructiva no demostrable | `users` schema |
| G-009 | `/me` sin módulos/actions | Frontend replica reglas | `access.service.ts` |
| G-010 | `/me` scopes por usuario global | Riesgo multi-organización futuro | `access.service.ts:83-105` |
| G-011 | Hardcoded UUIDs | Configuración no portable | scope service/config web |
| G-012 | Frontend `MTD` ambiguo | Presentación incorrecta de rol | `role-context.tsx`, `nav-config.ts` |
| G-013 | Audit de users fuera de tx | Cambio sin evidencia atómica | `users.service.ts` |
| G-014 | Permisos legacy/históricos sin estado | Mapping incompleto o UI engañosa | migrations 0000–0028 |
| G-015 | Reset no bloquea production | Destrucción operativa accidental | `reset.ts` |

## 13. Respuestas disponibles antes de implementar

| Pregunta | Respuesta auditada |
|---|---|
| ¿Por qué hay tantos usuarios? | Inserts de `0000`/`0005`, bootstrap opcional de 3 cuentas y usuarios creados por tests/helpers; no existe provenance unificada. |
| ¿Qué eliminar solo de runtime seed? | El objetivo es no crear `olp`, `medicarte`, `suspended`, `mtd-general` ni `mtd-auditoria` automáticamente; la eliminación física de existentes requiere clasificación. |
| ¿Qué reales preservar? | Todos los usuarios no demostrablemente fixture; el repositorio no permite identificar cada uno por provenance. |
| ¿Diferencia user/role/permission/module/scope? | Se define formalmente en `ESP-020-target-architecture.md`; hoy solo user/role/permission/scope existen como modelo formal. |
| ¿Cómo se representa admin? | Hoy `MTD_ADMIN`; target aprobado conserva el código y añade metadata/`ALLOW_ALL` explícito. |
| ¿Cómo se evita lockout? | Hoy solo validación secuencial; transacción + lock es un requerimiento pendiente. |
| ¿Qué módulos existen realmente? | Rutas y permisos auditados; catálogo canónico aún no existe. |
| ¿Qué acciones existen? | Implícitas en permission codes; deben mapearse y validarse antes de UI. |
| ¿Qué fronteras son hard? | MTD/OLP/MEDICARTE/COMPENSAR y scope por punto; D03 fija la matriz canónica estructural. |
| ¿Cómo sigue ESP-015? | RBAC y data scope siguen independientes; admin MTD debe ser global, no una lista artificial de puntos. |

## 13.1 Decisiones estructurales aprobadas adicionales

- **D03:** la matriz organización–rol será una policy canónica en domain; no será
  configurable desde UI/DB. Assignments históricos inválidos se reportan y se
  preservan inicialmente.
- **D05:** los permisos se clasifican como `ACTIVE`, `LEGACY`, `ORPHAN` o
  `RETIRED`; no se eliminan destructivamente en ESP-020.
- **D06:** se persiste provenance mínima; usuarios históricos sin evidencia quedan
  como `UNKNOWN`.
- **D07:** MTD conserva scope global, MEDICARTE scope explícito fail-closed y
  OLP/COMPENSAR no reciben point grants.
- **D08:** users, roles/access, assignments y scopes escriben cambio y audit en
  la misma transacción cuando forman parte del mismo acto administrativo.
- **D10:** no se editan migrations históricas; clean install usa un camino
  forward-compatible y existing DB usa clasificación, dry-run y confirmación.

