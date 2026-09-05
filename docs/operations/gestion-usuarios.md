# Gestión de usuarios y accesos (CRUD)

## Alcance

Desde ADR-026 la plataforma tiene un único plano de identidad:

1. **PostgreSQL (autenticación y autorización)**: la tabla `users` guarda `username` único
   case-insensitive, `password_hash` Argon2id, estado `active`, `must_change_password`,
   `password_changed_at` y `last_login_at`. Las organizaciones y roles viven en
   `user_organization_roles` con permisos derivados de `roles`/`permissions`/`role_permissions`.
2. **La API es la autoridad de autenticación**: valida la contraseña contra PostgreSQL, emite su
   propio JWT HS256 y, en cada request, recarga el usuario activo y sus permisos desde la base.
   Deshabilitar, eliminar o cambiar rol tiene efecto inmediato sin esperar expiración del token.

`oidc_subject` es un campo histórico DEPRECADO (subject del realm Keycloak ya retirado): no
autentica ni resuelve permisos.

Todo el ciclo de vida se administra desde la vista **Administración** de la web (visible solo con
el permiso `users.manage`, otorgado a `MTD_ADMIN`) o directamente contra la API `/api/v1/users`.

## Configuración

Variables de la API (`packages/config`):

| Variable                        | Descripción                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`               | Secreto HS256 con ≥256 bits (hex de 64+ o base64url de 32+ bytes). Obligatorio.                                                                                                                   |
| `AUTH_JWT_TTL_SECONDS`          | Vigencia del token; por defecto 28 800 s (8 h). No hay refresh tokens.                                                                                                                            |
| `AUTH_BOOTSTRAP_ADMIN_USERNAME` | Usuario del bootstrap local; por defecto `foundation-admin`.                                                                                                                                      |
| `AUTH_BOOTSTRAP_ADMIN_PASSWORD` | Si está definida y NO hay un `MTD_ADMIN` activo con contraseña local, crea/recupera esa cuenta. Nunca sobrescribe hashes existentes ni cambia roles en cada arranque. La contraseña no se loguea. |

## Endpoints

Autenticación (`/api/v1/auth`, sin sesión previa):

| Método y ruta                | Operación                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`           | `{username, password}` → `{accessToken, tokenType, expiresAt, mustChangePassword, user}`. Errores genéricos `INVALID_CREDENTIALS`. Rate limit: 20 intentos/min por combinación IP+username, además del límite global por IP. |
| `POST /auth/change-password` | Autenticado. `{currentPassword, newPassword}` (≥12). Actualiza hash, `password_changed_at` y baja `must_change_password`. Devuelve 204.                                                                                      |

Administración (`/api/v1/users`, permiso `users.manage`, header `X-Organization-Id`):

| Método y ruta                                   | Operación                                                                                                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /users?active=true\|false`                 | Lista usuarios locales con asignaciones, `passwordConfigured`, `mustChangePassword` y `lastLoginAt`. Nunca devuelve hash ni contraseña.                                                                                     |
| `POST /users`                                   | Crea la cuenta exclusivamente en PostgreSQL. Cuerpo: `username` (3–160, minúsculas), `displayName`, `password` (≥ 12), `organizationId`, `roleCode`. 201 con `UserResponse`; 409 `USERNAME_TAKEN` si el username ya existe. |
| `PATCH /users/:id`                              | Cambia `displayName` y/o `active`. Un admin no puede desactivarse a sí mismo (`SELF_DEACTIVATION_FORBIDDEN`) ni desactivar/retirar el rol al último administrador activo (`LAST_ADMIN_PROTECTED`).                          |
| `POST /users/:id/reset-password`                | `{password, mustChangePassword?}` — restablecimiento administrativo. Por defecto fuerza el cambio en el siguiente ingreso.                                                                                                  |
| `PUT /users/:id/assignments`                    | Asigna (o reactiva) `{organizationId, roleCode}` para el usuario.                                                                                                                                                           |
| `DELETE /users/:id/assignments/:organizationId` | Retira la asignación activa de esa organización (soft delete); protegido para el último admin.                                                                                                                              |

No existe registro público ni "sign up": toda creación es administrativa. La vieja bandeja de
`solicitudes pendientes` (`pending_user_requests`) desapareció con Keycloak: un usuario sin
cuenta local simplemente no puede autenticar.

## Bootstrap del primer administrador

En el primer arranque contra una base sin admin local (p. ej. recién migrada desde la versión con
Keycloak, cuando ninguna cuenta tiene `password_hash`), defina `AUTH_BOOTSTRAP_ADMIN_PASSWORD` con
una contraseña fuerte. La API creará (o habilitará, si el username ya existía sin hash) al usuario
con rol `MTD_ADMIN` en la organización `MTD`. Es idempotente: en arranches posteriores no hace
nada si ya existe un admin vigente, no imprime la contraseña y no reasigna roles.

## Auditoría

`audit_events` registra `LOGIN_SUCCESS` / `LOGIN_FAILED` (con IP, user-agent y causal interna:
`USER_NOT_FOUND`, `PASSWORD_MISMATCH`, `ACCOUNT_DISABLED`, `NO_LOCAL_PASSWORD`), `USER_CREATED`,
`USER_UPDATED`, `USER_ENABLED`, `USER_DISABLED`, `USER_ROLE_CHANGED`, `USER_PASSWORD_CHANGED` y
`USER_PASSWORD_RESET`. Nunca se registran contraseñas, hashes ni tokens. Las acciones históricas
de la era Keycloak (`ACCESS_REQUEST_*`, etc.) permanecen intactas (tabla append-only).

## Roles y permisos sembrados

Los roles disponibles (`MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA`,
`COMPENSAR_VIEWER`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY`) y su mapa de permisos
viven en las migraciones (`packages/database/migrations/0000_foundation.sql` y siguientes).
Crear un rol nuevo requiere migración, no es parte del CRUD.

`MTD_ADMIN` conserva todos los permisos. `READ_ONLY` tiene lectura de toda la operación, sin
permisos de escritura, administración ni Anexo Tarifario. `MTD_GENERAL` solo tiene lectura y exportación en
MIPRES, listos para dispensar, puntos de aplicación, logística OLP, soportes y consolidado.
`MTD_AUDITORIA` tiene lectura de resumen y autorizaciones, lectura/exportación de consolidado
y lectura/escritura exclusivamente del flujo de Auditoría. OLP y Medicarte conservan sus
permisos operativos y ya no tienen `dashboard.read`.

### Matriz efectiva de vistas

| Vista                        | foundation-admin | mtd-general         | mtd-auditoria       | OLP        | Medicarte  |
| ---------------------------- | ---------------- | ------------------- | ------------------- | ---------- | ---------- |
| Resumen ejecutivo            | total            | sin acceso          | lectura             | sin acceso | sin acceso |
| Autorizaciones               | total            | sin acceso          | lectura             | actual     | actual     |
| Direccionamientos MIPRES     | total            | lectura/exportación | sin acceso          | actual     | actual     |
| Listos para dispensar        | total            | lectura/exportación | sin acceso          | actual     | actual     |
| Puntos de aplicación         | total            | lectura/exportación | sin acceso          | actual     | actual     |
| Logística OLP                | total            | lectura/exportación | sin acceso          | actual     | actual     |
| Soportes                     | total            | lectura/exportación | sin acceso          | actual     | actual     |
| Auditoría                    | total            | sin acceso          | completo del módulo | actual     | actual     |
| Consolidado                  | total            | lectura/exportación | lectura/exportación | actual     | actual     |
| Administración/configuración | total            | sin acceso          | sin acceso          | actual     | actual     |

La navegación y el guard de rutas usan `view.*`, mientras los controladores vuelven a validar
las capacidades de lectura, escritura y exportación. La exportación `includeAll` de la base
completa de Autorizaciones está reservada a perfiles con la capacidad administrativa actual;
los dos perfiles MTD nuevos solo descargan el consolidado autorizado.

Los permisos `view.*` controlan navegación y rutas en la web; la API valida además permisos
de operación en cada endpoint. `dashboard.read`, `audit.read`, `audit.write` y
`consolidated.read` son capacidades independientes y no se infieren por ocultar menús.

## Buenas prácticas

- La contraseña inicial se envía por un canal seguro y se crea con `mustChangePassword` vía reset
  cuando se entregue a otra persona: el cambio forzado bloquea la app hasta que el usuario defina
  la suya.
- Desactivar (`PATCH active=false`) en lugar de eliminar: preserva historial de auditoría y FKs.
- Retirar accesos por organización con `DELETE .../assignments/:organizationId` cuando un operador
  cambia de área sin perder sus otros accesos.
- Rote el `AUTH_JWT_SECRET` solo de forma coordinada (invalida todas las sesiones activas).

## Verificación

```bash
pnpm test:integration   # incluye gate-f7-user-management.test.ts
```

El gate F7 cubre: permiso `users.manage`, creación local con hash Argon2id, duplicateo de username
(case-insensitive), política de longitud, login del usuario nuevo, asignaciones múltiples, cambio
voluntario de contraseña, reset administrativo con cambio forzado, desactivación (rechaza login y
corta tokens vigentes), reactivación, revocación de asignación, auto-desactivación y protección
del último administrador.

## Enlace de Google Drive

MTD_ADMIN puede configurar en `/administracion` el enlace HTTPS de la carpeta corporativa de
Google Drive. El valor se persiste en la organización MTD y queda auditado. Los usuarios con acceso
a Soportes o Auditoría lo visualizan en la cabecera como el enlace `Abrir Google Drive`; la
aplicación no carga ni administra archivos del Drive.
