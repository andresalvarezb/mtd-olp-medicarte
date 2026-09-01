# ADR-026 — Autenticación local con usuarios PostgreSQL y JWT propio

**Estado:** ACCEPTED
**Fecha:** 2026-09-01
**Sustituye a:** ADR-007 (en su parte de autenticación OIDC/Keycloak; la regla de RBAC local permanece vigente bajo esta decisión)

## Contexto

La plataforma autenticaba mediante Keycloak/OIDC (ADR-007): realm `authorization`, clientes
`authorization-web`/`authorization-api`/`authorization-admin`, servicio Keycloak en Docker con
PostgreSQL exclusivo en Render (`authorization-keycloak`, `authorization-keycloak-db`) y
administración de cuentas vía Admin REST API con client credentials.

Keycloak funcionaba correctamente, pero para el tamaño y alcance actuales del sistema su coste y
complejidad operacional son desproporcionados: un servicio stateful adicional, una base de datos
exclusiva, secrets de realm, import de configuración, doble modelo de identidad (Keycloak ↔
`users.oidc_subject`) y flujos de aprovisionamiento (bandeja de solicitudes pendientes) que solo
existían para cerrar la brecha entre ambos mundos.

No se introducirá otro proveedor externo de identidad.

## Decisión

- La autenticación es LOCAL y la API es la autoridad: `POST /api/v1/auth/login` valida
  usuario/contraseña contra PostgreSQL y emite un JWT propio (HS256, secreto `AUTH_JWT_SECRET`
  de ≥256 bits, TTL `AUTH_JWT_TTL_SECONDS`).
- La tabla `users` evoluciona (no se duplica) para ser la fuente de identidad: `username` único
  case-insensitive normalizado a minúsculas, `password_hash` Argon2id (formato PHC, parámetros
  OWASP: m=19 MiB, t=2, p=1), `must_change_password`, `password_changed_at`, `last_login_at`.
- Las contraseñas de Keycloak NO se migran (no exportables). `oidc_subject` queda como dato
  histórico nullable y DEPRECADO: ya no autentica ni resuelve permisos. El resto de la identidad
  lógica (ids, asignaciones `user_organization_roles`, auditoría, FKs) se preserva.
- Bootstrap idempotente del primer administrador: `AUTH_BOOTSTRAP_ADMIN_USERNAME` /
  `AUTH_BOOTSTRAP_ADMIN_PASSWORD` solo actúan si no existe un `MTD_ADMIN` activo con contraseña
  local; nunca sobrescriben hashes existentes ni reasignan roles en cada arranque; la contraseña
  nunca se loguea.
- La autorización NO cambia: se conservan organizaciones, `roles`, `permissions`,
  `role_permissions` y `user_organization_roles` (ADR-007) sin inventar roles nuevos. El JWT es
  solo credencial: tras verificar firma/exp, el guard RECARGA usuario y permisos desde
  PostgreSQL en cada request. Deshabilitar un usuario, eliminarlo o cambiar su rol tiene efecto
  inmediato sin esperar expiración del token.
- Errores de login genéricos (`INVALID_CREDENTIALS`), verificación dummy anti-timing,
  rate limiting dedicado en `/auth/login` (20 intentos/min por combinación IP+username) y límite global intacto.
- Política mínima de contraseña: longitud 12–128, sin reglas absurdas.
- `pending_user_requests` se elimina: la brecha entre IdP externo y cuenta local desaparece.
- Auditoría de eventos de identidad: LOGIN_SUCCESS, LOGIN_FAILED, USER_CREATED, USER_UPDATED,
  USER_ENABLED, USER_DISABLED, USER_ROLE_CHANGED, USER_PASSWORD_CHANGED, USER_PASSWORD_RESET,
  ACCESS_REQUEST_* históricos permanecen intactos (append-only). Nunca se registran contraseñas,
  hashes ni tokens.
- Keycloak desaparece de la arquitectura final: compose, Render, `infra/keycloak`, Dockerfile,
  variables OIDC y dependencias front muertas (`keycloak-js`). El retiro del recurso desplegado
  se ejecuta en dos gates documentados en `docs/operations/render.md` (Gate A: desplegar auth
  local con Keycloak aún existente; Gate B: eliminar `authorization-keycloak` y
  `authorization-keycloak-db`).

## Consecuencias positivas

- Menos coste (dos recursos Render eliminados) y menos infraestructura que operar.
- Menos puntos de fallo: una sola base de datos, sin sincronización de dos identidades.
- Administración de usuarios simple y atómica en PostgreSQL (sin compensaciones Keycloak↔BD).
- Login más rápido y predecible; efectos inmediatos de desactivación/cambio de rol.

## Consecuencias (responsabilidades asumidas)

- La aplicación es ahora responsable de: hashing y rotación de contraseñas, rate limiting,
  política de claves JWT, recuperación (reset administrativo), expiración de sesión y auditoría
  de autenticación.
- Sin refresh tokens en esta etapa: al expirar el JWT la Web vuelve a login (sesión de
  pestaña en sessionStorage).
- Sin MFA, sin SSO y sin autofijación de sesiones entre dispositivos: deliberado para el
  alcance actual.

## Revisión futura

Esta decisión debe reabrirse si aparecen requisitos reales de: SSO corporativo, MFA
empresarial, federación de identidad, SAML/LDAP, múltiples sistemas consumidores del mismo
token, o organizaciones externas gestionando sus propios usuarios. La separación
AuthGuard → AccessService (fuente de permisos siempre en PostgreSQL) mantiene el RBAC
independiente del emisor del token, lo que facilita migrar a un IdP externo si fuera
necesario.
