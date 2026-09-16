# ESP-020 — User / Seed Inventory

Estado: **AUDITADO / D06 Y D10 APPROVED / NO IMPLEMENTADO**
Objetivo: explicar por qué aparecen usuarios automáticamente y clasificar la
acción futura sin borrar usuarios reales por heurística.

Decisiones aprobadas el 2026-09-15:

- **D06:** persistir provenance mínima con `SYSTEM_BOOTSTRAP`,
  `TEST_FIXTURE`, `MANUAL_ADMIN_CREATED`, `MIGRATED_LEGACY` y `UNKNOWN`.
- **D10:** no modificar migrations históricas; clean install usa un camino
  forward-compatible y existing DB usa clasificación, dry-run y confirmación.

## 1. Regla de clasificación

El repositorio actual no tiene `users.provenance`, `created_by` ni un catálogo de
fixtures. Por tanto:

Las etiquetas siguientes son categorías de análisis de fuentes, no valores
persistidos de seguridad. El valor persistido aprobado es uno de los cinco
valores D06.

- `FIXTURE_DETERMINISTIC`: la fila tiene IDs, OIDC subjects, emails y relaciones
  sembradas con valores estáticos verificables en migrations.
- `BOOTSTRAP_TARGET`: la cuenta se crea/recupera por `BootstrapAdminService` a
  partir de variables de entorno.
- `TEST_FIXTURE`: la cuenta se crea desde tests/helpers y se elimina o limpia
  por patrón controlado.
- `REAL_OR_UNKNOWN`: cualquier cuenta que no sea demostrablemente una de las
  anteriores debe preservarse y queda con provenance persistida `UNKNOWN`.

No se permite un `DELETE FROM users` genérico ni una migración que borre por
username parecido sin evidencia.

## 2. Usuarios creados por migrations

| SOURCE | USER actual/derivado | ROLE | ENVIRONMENT | PURPOSE | CLASSIFICATION | TARGET ACTION |
|---|---|---|---|---|---|---|
| `packages/database/migrations/0000_foundation.sql:171-178` | `admin@example.test` → username derivado `admin` | MTD/`MTD_ADMIN`; OLP/`READ_ONLY` | Todas las bases que aplican migrations | Foundation demo/admin histórico | `FIXTURE_DETERMINISTIC` | En clean install no crear como cuenta runtime; en base existente preservar hasta reportar y clasificar. No asumir que equivale al nuevo bootstrap `foundation-admin`. |
| `packages/database/migrations/0000_foundation.sql:173-179` | `olp@example.test` → `olp` | OLP/`OLP_OPERATOR` | Todas las bases que aplican migrations | Operador demo de OLP | `FIXTURE_DETERMINISTIC` | No crear en clean install. En base existente: `MIGRATE` o `MANUAL_REVIEW`; no borrar automáticamente si ya fue reutilizado. |
| `packages/database/migrations/0000_foundation.sql:174-180` | `suspended@example.test` → `suspended` | MTD/`READ_ONLY`, inactive | Todas las bases que aplican migrations | Caso demo de usuario suspendido | `FIXTURE_DETERMINISTIC` | No crear en clean install. En base existente: reporte y `MANUAL_REVIEW`; conservar evidencia hasta decisión. |
| `packages/database/migrations/0005_phase4_operational_notifications.sql:173-178` | `medicarte@example.test` → `medicarte` | MEDICARTE/`MEDICARTE_OPERATOR` | Todas las bases que aplican migration 0005 | Operador demo de Medicarte | `FIXTURE_DETERMINISTIC` | No crear en clean install. En base existente: preservar si hay uso real; si solo coincide con fixture y no hay evidencia, `MANUAL_REVIEW`. |

Nota: `0013_local_auth.sql` no crea cuentas nuevas; deriva usernames y añade
credenciales locales nullable a usuarios existentes.

## 3. Usuarios creados por bootstrap de API

Fuente: `apps/api/src/identity/bootstrap.service.ts:27-130`.

| SOURCE | USER | ROLE | ENVIRONMENT | PURPOSE | CLASSIFICATION | TARGET ACTION |
|---|---|---|---|---|---|---|
| `AUTH_BOOTSTRAP_ADMIN_USERNAME` | Configurable, default `foundation-admin` | MTD/`MTD_ADMIN` | Docker, Render o cualquier API con password | Primer administrador local | `BOOTSTRAP_TARGET` | `KEEP_BOOTSTRAP_ADMIN`; único target de clean runtime |
| Literal `mtd-general` + `AUTH_BOOTSTRAP_MTD_GENERAL_PASSWORD` | `mtd-general` | MTD/`MTD_GENERAL` | Cualquier ambiente donde se configure la variable | Cuenta de conveniencia de desarrollo | `BOOTSTRAP_TARGET` | `REMOVE_RUNTIME_SEED`; conservar solo como fixture explícito de tests/dev |
| Literal `mtd-auditoria` + `AUTH_BOOTSTRAP_MTD_AUDITORIA_PASSWORD` | `mtd-auditoria` | MTD/`MTD_AUDITORIA` | Cualquier ambiente donde se configure la variable | Cuenta de conveniencia de desarrollo | `BOOTSTRAP_TARGET` | `REMOVE_RUNTIME_SEED`; crear bajo demanda desde UI o fixture aislado |

Comportamiento actual:

- usa una transacción;
- toma `pg_advisory_xact_lock`;
- no sustituye un hash existente;
- recupera una fila existente sin password;
- puede crear hasta tres cuentas si las tres passwords están configuradas.

ESP-020 debe conservar la idempotencia, pero dejar un solo target de
administrador. No se debe imprimir ninguna password.

## 4. Configuración por ambiente

| SOURCE | USER(S) | ENVIRONMENT | EVIDENCE | TARGET ACTION |
|---|---|---|---|---|
| `docker-compose.yml:62-65` | `foundation-admin` | Local Docker | Password hardcoded de desarrollo | Mantener solo como mecanismo de desarrollo documentado; eliminar hardcoded password del camino productivo y exigir secret/config segura |
| `render.yaml:48-59` | `foundation-admin`, opcionalmente `mtd-general`, `mtd-auditoria` | Render | `AUTH_BOOTSTRAP_ADMIN_PASSWORD` y dos variables opcionales `sync: false` | Mantener solo admin; retirar variables de los dos perfiles opcionales |
| `.env.example:6-13` | Admin y dos perfiles opcionales | Local/config | Declara las tres variables | Actualizar documentación futura para un solo admin |

La aplicación no tiene nombre oficial; la documentación target no debe introducir
un nombre de producto.

## 5. Usuarios creados por tests/helpers

Fuente principal: `tests/integration/helpers/auth.ts`.

| SOURCE | USER | ROLE | ENVIRONMENT | PURPOSE | CLASSIFICATION | TARGET ACTION |
|---|---|---|---|---|---|---|
| `ensureUser()` en `helpers/auth.ts:63-120` | Username parametrizado, por ejemplo `f7-user-*` | Test seleccionado | Integration DB | Crear fixture para un caso | `TEST_FIXTURE` | `KEEP_TEST_FIXTURE`; usar namespace y cleanup |
| `ensureOperatorTokens()` en `helpers/auth.ts:190-213` | `olp-operator` | OLP/`OLP_OPERATOR` | Integration/dev DB | Token operativo de tests | `TEST_FIXTURE` | `KEEP_TEST_FIXTURE`; nunca bootstrap runtime |
| `ensureOperatorTokens()` en `helpers/auth.ts:205-212` | `medicarte-operator` | MEDICARTE/`MEDICARTE_OPERATOR` | Integration/dev DB | Token operativo de tests | `TEST_FIXTURE` | `KEEP_TEST_FIXTURE`; asignar scopes explícitamente |
| `gate-f7-user-management.test.ts` | `f7-*` y `f7-second-admin-*` | `OLP_OPERATOR`, `READ_ONLY`, `MTD_ADMIN` | Integration DB | Gate de users/last admin | `TEST_FIXTURE` | `KEEP_TEST_FIXTURE`; cleanup por namespace |
| `gate-esp002/003/004/012/017/018/019` | `esp*-*` | Roles específicos del escenario | Integration DB | Gates aislados de módulos | `TEST_FIXTURE` | `KEEP_TEST_FIXTURE`; no mover a seed de runtime |

Los tests también pueden recuperar usuarios preexistentes y hacer reset de
password. Eso no convierte esas cuentas en runtime seed; los tests deben correr
contra una base aislada o limpiar por namespace.

## 6. Cuadro de decisión clean install vs base existente

### A. Instalación limpia

Resultado obligatorio después de migrations + bootstrap:

```text
users = 1
active administrator = 1
runtime fixture users = 0
runtime general/auditoria/operator users = 0
```

El proceso target debe:

1. aplicar schema/migrations;
2. no insertar usuarios demo en el camino runtime;
3. ejecutar bootstrap idempotente con una sola configuración;
4. crear una única cuenta con role `MTD_ADMIN`/`is_system_admin=true`;
5. dejar roles y permissions sembrados, pero no cuentas para esos roles.

### B. Local/dev con fixtures

Los operadores y lectores se crean explícitamente por:

- helper de test;
- comando de fixture identificado;
- UI administrativa después de iniciar sesión con el admin.

El mecanismo no debe ejecutarse en cada arranque normal de la API.

### C. Base existente

No se borran usuarios automáticamente. El plan debe:

1. registrar un snapshot de usuarios, asignaciones y passwordConfigured;
2. clasificar únicamente fixtures deterministas;
3. detectar cualquier cuenta con password local, login o audit asociado como
   `REAL_OR_UNKNOWN` hasta evidencia contraria;
4. preservar usuarios reales y sus roles/scopes;
5. ofrecer migración/inhabilitación explícita con confirmación;
6. conservar audit history y no reescribir `user_point_scopes`.

## 7. Provenance que falta

No se puede responder solo desde el código:

- si `admin`, `olp`, `medicarte` o `suspended` fueron reutilizados como cuentas
  reales;
- si una cuenta creada con username de bootstrap representa una persona real;
- si un fixture de integración quedó en una base compartida;
- qué usuario debe conservarse como administrador de una base existente cuando
  hay varios `MTD_ADMIN`.

Estas limitaciones quedan aceptadas como baseline operativo: las cuentas sin
evidencia suficiente se clasifican `UNKNOWN` y se preservan.

**APPROVED — D06:** nuevas cuentas y migraciones deben persistir provenance
explícita en el modelo de identidad, sin usarla como sustituto de autorización:

```text
SYSTEM_BOOTSTRAP
TEST_FIXTURE
MANUAL_ADMIN_CREATED
MIGRATED_LEGACY
UNKNOWN
```

La clasificación histórica debe seguir siendo conservadora.

## 8. Criterios de aceptación del inventario

- Una instalación limpia no crea `olp`, `medicarte`, `suspended`,
  `mtd-general` ni `mtd-auditoria`.
- Los roles continúan existiendo aunque no tengan usuarios.
- Los tests pueden crear sus usuarios aislados.
- Un deploy/redeploy no crea más de un admin.
- Una base existente no pierde usuarios por coincidencia de username.
- Toda cuenta candidata a desactivación física tiene evidencia y una acción
  explícita (`MIGRATE` o `MANUAL_REVIEW`).

