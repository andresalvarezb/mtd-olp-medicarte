# SPEC-008 — Autenticación local, organizaciones, roles y permisos

**Fase:** 1 y transversal

## Autenticación (ADR-026)

- `POST /api/v1/auth/login` con `username` (case-insensitive, normalizado a minúsculas) y
  `password`; la API valida el hash Argon2id contra PostgreSQL y emite JWT HS256 propio
  (`sub = users.id`). Errores genéricos `INVALID_CREDENTIALS`: no revelan existencia del
  usuario, estado activo ni motivo real (las causas quedan solo en auditoría).
- Rate limiting dedicado de login (20 intentos/min por combinación IP+username), además del límite global por IP.
- El JWT es solo credencial: tras verificar firma/exp, el guard recarga el usuario activo y
  AccessService resuelve roles/permisos desde PostgreSQL en cada request. Desactivación,
  eliminación o cambio de rol tienen efecto inmediato.
- Administración de usuarios exclusivamente administrativa (`users.manage`): alta con username +
  contraseña inicial, activar/desactivar, cambio de rol por asignación, restablecimiento de
  contraseña con `must_change_password`, cambio voluntario vía `POST /api/v1/auth/change-password`.
  No hay registro público ni solicitudes pendientes (flujo Keycloak eliminado).
- El último administrador activo está protegido: no puede ser desactivado ni quedar sin rol
  administrativo; la auto-desactivación está prohibida.

## Matriz confirmada

| Capacidad                         | MEDICARTE | OLP                              | MTD                                      |
| --------------------------------- | --------- | -------------------------------- | ---------------------------------------- |
| Consultar registros relacionados  | Sí        | Sí                               | Según rol; lectura global cuando aplique |
| Descargar base completa permitida | Sí        | Sí, incluye `lugar_dispensacion` | Según rol                                |
| Bulk `lugar_dispensacion`         | Sí        | No                               | No                                       |
| Bulk `fecha_dispensacion`         | No        | Sí                               | No                                       |
| Bulk `fecha_aplicacion`           | Sí        | No                               | No                                       |
| Auditar soportes/decidir          | No        | No                               | Auditor autorizado                       |
| Administrar configuración Drive   | No        | No                               | MTD Admin                                |

Compensar conserva lectura de autorizaciones y consolidado solo con permiso explícito. MTD mantiene administración y auditoría según rol, pero no suplanta las cargas operativas exclusivas de OLP o MEDICARTE. Una corrección excepcional por MTD requeriría una decisión y permiso futuros explícitos.

## Permisos atómicos

- `authorizations.read`
- `authorizations.read_sensitive`
- `operational_exports.create`
- `bulk_updates.dispensation_location`
- `bulk_updates.dispensation_date`
- `bulk_updates.application_date`
- `bulk_updates.read`
- `audit.start`, `audit.approve`, `audit.reject`
- `drive_config.manage`

Se eliminan del alcance `attachments.upload`, `attachments.read`, `dispensing.register` y `application_site.assign` como permisos funcionales del nuevo proceso. Una migración futura deberá retirar seeds obsoletos sin reinterpretarlos.

## Regla

Cada request, lote, fila, replay y descarga aplica permiso + organización + relación del recurso en backend. La UI solo refleja autorización. El tipo de bulk determina una columna fija; poseer permiso para un tipo nunca habilita otras columnas.

## Tests obligatorios

- login válido/inválido/inexistente/inactivo, username case-insensitive y hash nunca expuesto;
- JWT inválido, expirado o manipulado → 401; usuario desactivado o eliminado tras emitir el
  token → 401 inmediato; cambio de rol visible sin re-login;
- acceso horizontal y elevación vertical;
- usuario suspendido y multi-organización;
- lectura sensible/redacción en exportación;
- MEDICARTE intentando fecha de dispensación;
- OLP intentando lugar o fecha de aplicación;
- columnas extra o tipo manipulado;
- consulta/replay de lote por otra organización;
- actor no auditor intentando aprobar.
