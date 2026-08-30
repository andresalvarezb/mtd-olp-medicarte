# Vista de Login

## Alcance

Pantalla de inicio de sesión del prototipo visual (`apps/web`). Es una maqueta: **no valida credenciales** contra Keycloak ni ningún proveedor de identidad. El flujo real de autenticación (Keycloak / OIDC, realm `authorization`) se integrará cuando la API y el frontend se conecten; esta vista deja el punto de enganche preparado.

## Ruta y archivos

| Archivo | Rol |
|---|---|
| `apps/web/app/login/page.tsx` | Ruta `/login` (App Router de Next.js) |
| `apps/web/features/auth/login-view.tsx` | Vista del formulario (componente cliente) |
| `apps/web/components/layout/role-context.tsx` | Estado de sesión: `status`, `user`, `login()`, `logout()` |
| `apps/web/components/layout/app-shell.tsx` | Guard de autenticación y bypass del chrome en `/login` |
| `apps/web/components/layout/topbar.tsx` | Usuario autenticado y botón **Salir** |
| `apps/web/app/globals.css` | Estilos (sección `/* Login */`) |

## Comportamiento

1. **Rutas protegidas:** cualquier ruta distinta de `/login` exige sesión. Si no existe, `AppShell` redirige a `/login`.
2. **Login:** el formulario pide correo, contraseña y la *vista de demostración* (rol: MTD, Compensar, OLP o Medicarte). Al enviar:
   - persiste el rol en `localStorage` (clave `authz-demo-role`),
   - persiste la sesión en `localStorage` (clave `authz-demo-session`, guarda el correo),
   - redirige a `/`.
3. **Sesión activa:** si el usuario ya está autenticado e intenta entrar a `/login`, es redirigido a `/`.
4. **Logout:** el botón **Salir** del topbar limpia la sesión y redirige a `/login`. El rol seleccionado se conserva.
5. **Identidad demo:** el nombre y las iniciales del topbar se derivan del correo ingresado (p. ej. `ana.gomez@compensar.com` → "Ana Gomez" / "AG").
6. **Carga inicial:** mientras se hidrata el estado desde `localStorage`, `AppShell` muestra un estado de carga y evita redirecciones prematuras.

## Migración futura a Keycloak

- Reemplazar `login()` en `role-context.tsx` por el flujo OIDC (ya existe la dependencia `keycloak-js` en `apps/web`).
- Derivar el rol del token (`OIDC_AUDIENCE: authorization-api`), eliminando el selector de vista de demostración.
- Sustituir el guard de `AppShell` por el gestor de sesión de Keycloak (silent check SSO / login redirect).
- Conservar la ruta `/login` como pantalla de transición o eliminarla según el flujo elegido.
