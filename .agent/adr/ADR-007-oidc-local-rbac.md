# ADR-007 — OIDC para identidad, RBAC local para autorización

**Estado:** SUPERSEDED por ADR-026 (2026-09-01). La autenticación OIDC/Keycloak fue reemplazada
por autenticación local con usuarios PostgreSQL y JWT propio. **La segunda mitad de esta decisión
sigue vigente e íntegramente incorporada en ADR-026:** RBAC local (organizaciones, membresías,
roles y permisos en PostgreSQL) y "nunca confiar en la UI". Se conserva por historia.

## Decisión

Keycloak/OIDC autentica. La aplicación decide acceso usando organizaciones, membresías, roles y permisos locales.

## Regla

Nunca confiar en la UI para seguridad. Cada endpoint y cada consulta sensible debe aplicar alcance de organización y permiso.
