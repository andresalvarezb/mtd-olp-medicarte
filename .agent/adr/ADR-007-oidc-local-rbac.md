# ADR-007 — OIDC para identidad, RBAC local para autorización

**Estado:** ACCEPTED

## Decisión

Keycloak/OIDC autentica. La aplicación decide acceso usando organizaciones, membresías, roles y permisos locales.

## Regla

Nunca confiar en la UI para seguridad. Cada endpoint y cada consulta sensible debe aplicar alcance de organización y permiso.
