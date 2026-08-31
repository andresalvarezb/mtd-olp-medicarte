# Gestión de usuarios y accesos (CRUD)

## Alcance

La gestión de accesos combina dos planos:

1. **Keycloak (autenticación)**: el usuario debe existir en el realm `authorization` para poder obtener un token. La plataforma lo crea y deshabilita vía la Admin REST API usando el cliente de servicio `authorization-admin`.
2. **PostgreSQL (autorización)**: la tabla `users` vincula el `sub` de Keycloak (`oidc_subject`) con organizaciones y roles (`user_organization_roles`). Los permisos del token solo importan a través de este mapeo local: un token válido sin fila local activa es rechazado con `LOCAL_USER_INACTIVE`.

Todo el ciclo de vida se administra desde la vista **Administración** de la web (visible solo con el permiso `users.manage`, otorgado a `MTD_ADMIN`) o directamente contra la API `/api/v1/users`.

## Configuración

Variables de la API (`packages/config`):

| Variable                   | Descripción                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ADMIN_ISSUER`        | Issuer para la Admin API. Por defecto usa `OIDC_ISSUER`; en Compose apunta a `http://keycloak:8080/realms/authorization`. |
| `OIDC_ADMIN_CLIENT_ID`     | Cliente confidencial con service account. Por defecto `authorization-admin`.                                              |
| `OIDC_ADMIN_CLIENT_SECRET` | Secret del cliente. Si falta, los endpoints de creación/deshabilitación responden 503 `KEYCLOAK_ADMIN_NOT_CONFIGURED`.    |

El realm export (`infra/keycloak/realm-export.json`) define el cliente `authorization-admin` con su service account y los roles de realm-management `manage-users`, `view-users` y `view-clients`.

## Endpoints (permiso `users.manage`, header `X-Organization-Id`)

| Método y ruta                                   | Operación                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /users?active=true\|false`                 | Lista usuarios con sus asignaciones (organización, rol, estado).                                                                                                                                |
| `POST /users`                                   | Crea el usuario en Keycloak y en la base local de forma atómica. Cuerpo: `email`, `displayName`, `password` (≥ 8), `organizationId`, `roleCode`. Devuelve 201 con el `UserResponse`.            |
| `PATCH /users/:id`                              | Cambia `displayName` y/o `active`. Desactivar también deshabilita al usuario en Keycloak y le impide iniciar sesión. Un admin no puede desactivarse a sí mismo (`SELF_DEACTIVATION_FORBIDDEN`). |
| `PUT /users/:id/assignments`                    | Asigna (o reactiva) `{organizationId, roleCode}` para el usuario.                                                                                                                               |
| `DELETE /users/:id/assignments/:organizationId` | Retira la asignación activa de esa organización (soft delete).                                                                                                                                  |
| `GET /users/pending-requests`                   | Bandeja de solicitudes de acceso pendientes.                                                                                                                                                    |
| `POST /users/pending-requests/:id/approve`      | Aprueba la solicitud: crea la cuenta local con el `subject` capturado y asigna `{organizationId, roleCode}`.                                                                                    |
| `POST /users/pending-requests/:id/reject`       | Rechaza la solicitud.                                                                                                                                                                           |

Las operaciones quedan auditadas en `audit_events` con acciones `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_ROLE_ASSIGNED`, `USER_ROLE_REVOKED`, `ACCESS_REQUEST_APPROVED` y `ACCESS_REQUEST_REJECTED`.

## Bandeja de solicitudes de acceso

Cuando un usuario autenticado en Keycloak intenta usar la plataforma sin cuenta local (o con cuenta inactiva), `GET /me` responde 401 `LOCAL_USER_INACTIVE` y, de forma automática y best-effort, registra la solicitud en `pending_user_requests` con el `sub` y el email del token. El administrador la aprueba (elige organización y rol) o la rechaza desde la bandeja; aprobar crea la fila local vinculando ese `oidc_subject`, de modo que el siguiente inicio de sesión ya resuelve permisos.

El campo `pending_user_requests.status` usa `PENDIENTE`, `APROBADO` y `RECHAZADO`. Los códigos de error y las acciones de auditoría conservan sus identificadores técnicos.

Este flujo cierra el hueco entre crear un usuario en Keycloak y provisionarlo localmente: nunca hay que copiar `sub` a mano.

## Roles y permisos sembrados

Los roles disponibles (`MTD_ADMIN`, `MTD_OPERATOR`, `MTD_AUDITOR`, `COMPENSAR_VIEWER`, `OLP_OPERATOR`, `MEDICARTE_OPERATOR`, `READ_ONLY`) y su mapa de permisos viven en las migraciones (`packages/database/migrations/0000_foundation.sql` y siguientes). `MTD_AUDITOR` solo se puede asignar a MTD y permite consultar autorizaciones, iniciar la revisión y dar visto bueno; no permite rechazar, registrar hallazgos, importar, exportar ni administrar usuarios. Crear un rol nuevo requiere migración, no es parte del CRUD.

## Buenas prácticas

- La contraseña inicial se envía por un canal seguro; en producción conviene forzar restablecimiento desde la consola de Keycloak (el flujo web actual usa password grant y no soporta contraseñas temporales).
- Desactivar (`PATCH active=false`) en lugar de eliminar: preserva historial de auditoría y asignaciones.
- Retirar accesos por organización con `DELETE .../assignments/:organizationId` cuando un operador cambia de área sin perder sus otros accesos.

## Verificación

```bash
pnpm test:integration   # incluye gate-f7-user-management.test.ts
```

El gate F7 cubre: creación atómica Keycloak + local, primer inicio de sesión, asignaciones múltiples, desactivación (rechaza login), reactivación, revocación de asignación, registro de solicitud pendiente, aprobación y bloqueo de auto-desactivación.
