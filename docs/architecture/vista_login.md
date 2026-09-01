# Vista de inicio de sesión (autenticación local)

## Alcance actual

Pantalla de ingreso de `apps/web` (`features/auth/login-view.tsx`). Desde ADR-026 la
autenticación es LOCAL: no hay Keycloak, OIDC ni proveedor externo.

## Flujo

```text
Usuario + contraseña (formulario)
   │  login(username, password)                       components/layout/role-context.tsx
   ▼
POST {API}/auth/login                                 lib/auth.ts → authenticate()
   │  200 { accessToken, expiresAt, mustChangePassword, user }
   ▼  sesión en sessionStorage['authz-api-session'] (pestaña; NUNCA localStorage)
GET {API}/me                                          lib/api-client.ts (Authorization: Bearer)
   │  organizaciones + roles + permisos → sessionStorage['authz-api-me']
   ▼
AppShell renderiza según roles; sidebar/facciones según permisos (hasPermission)
```

- Login 401 → mensaje genérico `INVALID_CREDENTIALS` (la API no revela si el usuario existe o
  está deshabilitado). Rate limiting: 5 intentos/min por IP.
- Al recargar la página, `RoleProvider` revalida llamando a `/me`: si el token venció o el
  usuario fue desactivado/eliminado, la sesión se cierra y vuelve a `/login` (efecto
  inmediato, ADR-026). Cualquier 401 de `apiRequest` dispara el evento
  `authz:session-expired` que limpia la sesión.
- `mustChangePassword=true` (reset administrativo o bootstrap) muestra el
  `PasswordChangeGate` que bloquea la app hasta `POST /auth/change-password`.
- No hay refresh tokens: al vencer la sesión (default 8 h) se vuelve a login.
- Logout local: `logout()` elimina token y perfil de `sessionStorage` y redirige a `/login`.
  La API no tiene estado de sesión que cerrar (JWT stateless); la revocación real es
  desactivar/eliminar el usuario en Administración.

## Seguridad

La UI solo refleja la autorización; toda decisión de acceso se toma en el backend
(guard JWT + recarga de usuario activo + `users.manage`/permisos por organización). El
formulario nunca muestra ni persiste la contraseña fuera del envío al login.

## Verificación

`apps/web/lib/auth.test.ts` cubre login válido, credenciales inválidas, API inalcanzable,
expiración y limpieza de sesión (ADR-026).
