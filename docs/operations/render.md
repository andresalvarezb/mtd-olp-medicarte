# Despliegue preparado para Render

## Alcance

`render.yaml` declara todos los recursos del Blueprint, pero crear o sincronizar el Blueprint sigue siendo una acción manual fuera del repositorio. La región `virginia` usada por el Blueprint está aprobada por ADR-017/DEC-009; antes de sincronizar, revisar únicamente los planes y costos.

| Recurso                  | Tipo Render              | Imagen/configuración                             | Región     |
| ------------------------ | ------------------------ | ------------------------------------------------ | ---------- |
| `authorization-web`      | Web Service Docker       | `infra/docker/web.Dockerfile`                    | `virginia` |
| `authorization-api`      | Web Service Docker       | `infra/docker/api.Dockerfile`                    | `virginia` |
| `authorization-worker`   | Background Worker Docker | `infra/docker/worker.Dockerfile`                 | `virginia` |
| `authorization-keyvalue` | Render Key Value         | `noeviction`, `journal-snapshot`, acceso privado | `virginia` |
| `authorization-db`       | Render PostgreSQL 17     | base principal, acceso privado                   | `virginia` |

Desde ADR-026 no existe servicio de identidad externo: la autenticación es local (usuarios
PostgreSQL + JWT propio de la API). Los recursos `authorization-keycloak` y
`authorization-keycloak-db` fueron retirados del Blueprint; el procedimiento de retiro en dos
gates está documentado más abajo.

Render no ofrece región Colombia. La región de producción aprobada en ADR-017/DEC-009 es Virginia, USA: `virginia` mantiene juntos todos los recursos y satisface esa decisión. La residencia y el procesamiento de servicios, bases de datos y datos administrados por Render en Virginia quedan expresamente aceptados; la ausencia de región Colombia no bloquea producción.

## Topología final

```text
Internet
   │
   ▼
authorization-web ──(HTTPS, bearer JWT)──► authorization-api ──► authorization-db (users, roles, datos)
                                              │
                                              └────────────────► authorization-keyvalue (BullMQ/outbox)
                                                                       ▲
                                                                       │
                                                            authorization-worker
```

## Red y puertos

- API escucha en `0.0.0.0:(PORT ?? API_PORT ?? 3001)`. Render fija `PORT=10000`; Compose conserva `API_PORT=3001`.
- Web standalone escucha en `HOSTNAME:PORT`. Render fija `0.0.0.0:10000`; Compose fija `0.0.0.0:3000` y publica `127.0.0.1:3002`.
- Worker usa `NestFactory.createApplicationContext`; no crea servidor HTTP ni consume `PORT`.
- El health check de API es `GET /api/v1/health` y comprueba API, PostgreSQL y Key Value.

## Migraciones

El build de API ejecuta `pnpm --filter @authorization/api... build`. El selector incluye `@authorization/database`, cuyo `tsc` genera `packages/database/dist/migrate.js`. La imagen final copia también `packages/database/migrations`, por lo que el comando de producción es:

```bash
node packages/database/dist/migrate.js
```

`authorization-api` y `authorization-worker` usan ese comando como `preDeployCommand`. Ambos planes declarados son pagados y ambas imágenes incluyen el artefacto. El migrador obtiene `DATABASE_URL` mediante una referencia `fromDatabase` y usa un advisory lock de PostgreSQL para serializar despliegues concurrentes antes de iniciar cada nueva instancia.

## Autenticación local reproducible

- La migración `0013_local_auth` evoluciona `users` (username único case-insensitive,
  `password_hash`, banderas de contraseña), depreciona `oidc_subject` a dato histórico nullable y
  elimina `pending_user_requests`.
- Al arrancar, la API aplica el bootstrap idempotente de `AUTH_BOOTSTRAP_ADMIN_*`: solo actúa si
  no existe un `MTD_ADMIN` activo con contraseña local, nunca sobrescribe hashes existentes y no
  imprime secretos (ADR-026).
- `AUTH_JWT_SECRET` con `generateValue: true`: Render lo genera (256 bits base64) al crear el
  recurso, lo persiste y lo reutiliza en syncs y deploys posteriores. Rotarlo invalida todas las
  sesiones activas (logout general).
- Las cuentas restantes se crean desde la vista Administración (`users.manage`).

## Variables de Web

"Pública" significa que el valor queda incluido en el JavaScript del navegador. Las demás variables pueden contener valores no secretos, pero no se publican por el mecanismo `NEXT_PUBLIC_*`.

| Variable                | Consumidor                              | Fase            | Pública | Secreta | Origen en Render                 |
| ----------------------- | --------------------------------------- | --------------- | ------- | ------- | -------------------------------- |
| `NEXT_PUBLIC_API_URL`   | `apps/web/lib/config.ts` y cliente REST | Build           | Sí      | No      | URL pública de API con `/api/v1` |
| `NODE_ENV`              | Next.js/Node                            | Build y runtime | No      | No      | Imagen: `production`             |
| `HOSTNAME`              | servidor standalone de Next.js          | Runtime         | No      | No      | `0.0.0.0`                        |
| `PORT`                  | servidor standalone de Next.js          | Runtime         | No      | No      | `10000` en Render; `3000` en Compose |

No existe ninguna variable OIDC/Keycloak en la Web. Web debe reconstruirse cuando cambie
`NEXT_PUBLIC_API_URL` porque Next.js embebe `NEXT_PUBLIC_*` durante `next build`.

## Variables de API

Todas son runtime. `packages/config/src/index.ts` valida el conjunto al arrancar.

| Variable                              | Consumidor/efecto                                         | Pública | Secreta | Configuración Render                              |
| ------------------------------------- | --------------------------------------------------------- | ------- | ------- | ------------------------------------------------- |
| `NODE_ENV`                            | modo producción, proxy confiable y módulos no productivos | No      | No      | `production`                                      |
| `LOG_LEVEL`                           | logger Pino                                               | No      | No      | `info`                                            |
| `DATABASE_URL`                         | pool PostgreSQL y migrador pre-deploy                     | No      | Sí      | `authorization-db.connectionString`               |
| `REDIS_URL`                            | IORedis/BullMQ                                            | No      | Sí      | `authorization-keyvalue.connectionString`         |
| `AUTH_JWT_SECRET`                     | firma/verificación HS256 del JWT propio                   | No      | Sí      | `generateValue: true`                             |
| `AUTH_JWT_TTL_SECONDS`                | vigencia del access token                                 | No      | No      | `28800` (8 h)                                     |
| `AUTH_BOOTSTRAP_ADMIN_USERNAME`       | usuario del bootstrap local                               | No      | No      | `foundation-admin`                                |
| `AUTH_BOOTSTRAP_ADMIN_PASSWORD`       | contraseña inicial del admin (solo primer arranque)       | No      | Sí      | `sync: false`                                     |
| `PORT`                                 | puerto preferido del listener HTTP                        | No      | No      | `10000`                                           |
| `API_PORT`                             | fallback local cuando no existe `PORT`                    | No      | No      | Omitida; default `3001`                           |
| `API_PUBLIC_URL`                       | validación de URL pública HTTPS                           | No      | No      | URL pública de API                                |
| `WEB_ORIGIN`                           | política CORS                                             | No      | No      | URL pública de Web                                |
| `IMPORT_MAX_FILE_BYTES`                | límite de archivo                                         | No      | No      | Omitida; default `20971520`                       |
| `IMPORT_PROCESSOR_VERSION`             | idempotencia y versión de jobs                            | No      | No      | Omitida; default `2`                              |
| `MIPRES_MANUAL_RECHECK_DAILY_LIMIT`    | límite de revalidación manual                             | No      | No      | Omitida; default `5`                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT`          | exportador OpenTelemetry                                  | No      | No      | Omitida; integración opcional                     |
| `SENTRY_DSN`                           | captura Sentry                                            | No      | Sí      | Omitida; integración opcional                     |
| `MIPRES_BASE_URL`                      | validada por el schema común; sin consumidor API          | No      | No      | Omitida                                           |
| `MIPRES_NIT`                           | validada por el schema común; sin consumidor API          | No      | Sí      | Omitida                                           |
| `MIPRES_INITIAL_TOKEN`                 | validada por el schema común; sin consumidor API          | No      | Sí      | Omitida                                           |
| `MIPRES_TIMEOUT_MS`                    | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `15000`                          |
| `MIPRES_HTTP_RETRIES`                  | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `2`                              |
| `MIPRES_CIRCUIT_BREAKER_THRESHOLD`     | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `5`                              |
| `MIPRES_CIRCUIT_BREAKER_COOLDOWN_MS`   | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `30000`                          |
| `MIPRES_QUEUE_CONCURRENCY`             | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `2`                              |
| `MIPRES_AUTO_REVALIDATION_INTERVAL_MS` | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `43200000`                       |
| `MIPRES_AUTO_REVALIDATION_BATCH`       | validada por el schema común; sin consumidor API          | No      | No      | Omitida; default `100`                            |
| `GMAIL_SENDER`                         | validada por el schema API; sin consumidor API            | No      | No      | Omitida                                           |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`         | validada por el schema API; sin consumidor API            | No      | No      | Omitida                                           |
| `GOOGLE_PRIVATE_KEY`                   | validada por el schema API; sin consumidor API            | No      | Sí      | Omitida                                           |
| `GMAIL_TIMEOUT_MS`                     | validada por el schema API; sin consumidor API            | No      | No      | Omitida; default `15000`                          |

## Variables de Worker

Todas son runtime y ninguna es pública. El worker no consume `PORT` ni participa de la
autenticación (no recibe variables `AUTH_*`).

| Variable                               | Consumidor/efecto                                   | Secreta | Configuración Render                      |
| -------------------------------------- | --------------------------------------------------- | ------- | ----------------------------------------- |
| `NODE_ENV`                             | entorno Sentry/configuración                        | No      | `production`                              |
| `LOG_LEVEL`                            | logger Pino                                         | No      | `info`                                    |
| `DATABASE_URL`                         | pool PostgreSQL                                     | Sí      | `authorization-db.connectionString`       |
| `REDIS_URL`                            | BullMQ/IORedis                                      | Sí      | `authorization-keyvalue.connectionString` |
| `OTEL_EXPORTER_OTLP_ENDPOINT`          | opcional por schema; sin inicialización OTEL Worker | No      | Omitida                                   |
| `SENTRY_DSN`                           | captura Sentry                                      | Sí      | Omitida; integración opcional             |
| `IMPORT_MAX_FILE_BYTES`                | validada; sin uso posterior en Worker               | No      | Omitida; default `20971520`               |
| `IMPORT_PROCESSOR_VERSION`             | compatibilidad/idempotencia de jobs                 | No      | Omitida; default `2`                      |
| `IMPORT_QUEUE_CONCURRENCY`             | concurrencia de importaciones                       | No      | Omitida; default `3`                      |
| `BULK_QUEUE_CONCURRENCY`               | concurrencia de actualizaciones masivas             | No      | Omitida; default `3`                      |
| `NOTIFICATION_QUEUE_CONCURRENCY`       | concurrencia de notificaciones                      | No      | Omitida; default `5`                      |
| `SCHEDULER_ENABLED`                    | activa dispatcher y tareas periódicas               | No      | `true`                                    |
| `OUTBOX_POLL_INTERVAL_MS`              | frecuencia de polling de outbox                     | No      | Omitida; default `1000`                   |
| `MIPRES_BASE_URL`                      | adaptador HTTP MIPRES                               | No      | endpoint existente documentado            |
| `MIPRES_NIT`                           | generación de token MIPRES                          | Sí      | `sync: false`                             |
| `MIPRES_INITIAL_TOKEN`                 | generación de token MIPRES                          | Sí      | `sync: false`                             |
| `MIPRES_TIMEOUT_MS`                    | timeout HTTP MIPRES                                 | No      | Omitida; default `15000`                  |
| `MIPRES_HTTP_RETRIES`                  | reintentos HTTP MIPRES                              | No      | Omitida; default `2`                      |
| `MIPRES_CIRCUIT_BREAKER_THRESHOLD`     | umbral de circuit breaker                           | No      | Omitida; default `5`                      |
| `MIPRES_CIRCUIT_BREAKER_COOLDOWN_MS`   | enfriamiento de circuit breaker                     | No      | Omitida; default `30000`                  |
| `MIPRES_QUEUE_CONCURRENCY`             | concurrencia de cola MIPRES                         | No      | Omitida; default `2`                      |
| `MIPRES_AUTO_REVALIDATION_INTERVAL_MS` | intervalo de revalidación automática                | No      | Omitida; default `43200000`               |
| `MIPRES_AUTO_REVALIDATION_BATCH`       | tamaño de lote de revalidación                      | No      | Omitida; default `100`                    |
| `MIPRES_MANUAL_RECHECK_DAILY_LIMIT`    | validada; sin uso posterior en Worker               | No      | Omitida; default `5`                      |
| `GMAIL_SENDER`                         | remitente y delegación Gmail                        | No      | `sync: false` por ambiente                |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`         | identidad de service account Google                 | No      | `sync: false` por ambiente                |
| `GOOGLE_PRIVATE_KEY`                   | firma JWT de Google                                 | Sí      | `sync: false`                             |
| `GMAIL_TIMEOUT_MS`                     | timeout de Gmail/OAuth                              | No      | Omitida; default `15000`                  |

## Variables auxiliares locales y de pruebas

| Servicio/contexto  | Variable                                                   | Consumidor                                | Secreta                                 |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------- | --------------------------------------- |
| PostgreSQL Compose | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`        | imagen oficial PostgreSQL                 | Password: sí, solo valor local conocido |
| Compose dev        | `AUTH_JWT_SECRET`, `AUTH_BOOTSTRAP_ADMIN_*`                | API local (valores de desarrollo fijos)   | Sí, solo valores locales conocidos      |
| MIPRES mock        | `PORT`                                                     | listener mock                             | No                                      |
| MIPRES mock        | `MIPRES_MOCK_INITIAL_TOKEN`, `MIPRES_MOCK_OPERATIVE_TOKEN` | mock local                                | Sí, solo valores locales conocidos      |
| Integración        | `API_URL`, `DATABASE_URL`, `AUTH_DEV_ADMIN_USERNAME`, `AUTH_DEV_ADMIN_PASSWORD` | gates `tests/integration` (`helpers/auth.ts`) | `DATABASE_URL`: sí |

## Valores solicitados al crear el Blueprint

- `AUTH_BOOTSTRAP_ADMIN_PASSWORD`: definida con `sync: false`; debe suministrarse como secreto
  externo en el primer despliegue y nunca se genera ni se escribe en el Blueprint.
- `MIPRES_NIT` y `MIPRES_INITIAL_TOKEN`.
- `GMAIL_SENDER`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_PRIVATE_KEY`.

`AUTH_JWT_SECRET` se genera con `generateValue: true` y no requiere ingreso manual. Render genera y
referencia automáticamente passwords de la base y la cadena de conexión de Key Value; no deben
introducirse manualmente ni copiarse al repositorio.

## Recuperación de un Blueprint parcialmente creado

`sync: false` solo se solicita durante la creación inicial del Blueprint; un sync posterior lo ignora. Si la creación inicial falla a mitad, los recursos creados después del fallo pueden quedar sin esos valores y el Blueprint no los volverá a pedir: se recuperan ingresándolos manualmente en el servicio correspondiente desde el Dashboard.

Para secretos que no dependen de un valor externo, la alternativa soportada es `generateValue: true`: Render genera un valor aleatorio de 256 bits codificado en base64 al crear el recurso, lo persiste en el servicio y lo reutiliza en syncs y deploys posteriores. El valor nunca queda en Git, no se hardcodea y sigue siendo recuperable desde Dashboard → servicio → Environment (revelar/copiar). Así se resuelve `AUTH_JWT_SECRET`; la contraseña de bootstrap debe permanecer como secreto externo mediante `sync: false`.

Recuperación de acceso administrativo si se pierde `AUTH_BOOTSTRAP_ADMIN_PASSWORD`: crear un
registro de bootstrap nuevo no es posible mientras exista un admin vigente; la vía soportada es
INSERTAR un `user_organization_roles` a un usuario administrador existente con contraseña nueva
(hash Argon2id generado con `apps/api/src/identity/password.ts` vía `node -e`) directamente en
`authorization-db` desde el shell de Render, o rotar `AUTH_BOOTSTRAP_ADMIN_*` desactivando
temporalmente al último admin. Cualquier recuperación queda auditada manual en el runbook.

## Plan de retiro de Keycloak en producción (dos gates)

El `render.yaml` final ya no declara Keycloak, pero master está conectado a Auto Sync y la
eliminación de recursos es destructiva: se ejecuta en dos gates, nunca en un solo paso.

### Gate A — desplegar auth local con Keycloak aún vivo

1. Hacer merge a master de la rama `refactor/local-auth-remove-keycloak` (solo tras revisión).
   Auto Sync desplegará la nueva API/Web/Worker SIN las variables OIDC.
2. Antes del merge, fijar en el Dashboard de `authorization-api` (predeploy, ambiente a ambiente):
   `AUTH_JWT_SECRET` (generateValue o valor propio de ≥256 bits) y, si el primer arranque productivo
   aún no tiene admin local, `AUTH_BOOTSTRAP_ADMIN_PASSWORD` temporal.
3. El preDeployCommand corre `0013_local_auth` (migración forward-only, segura sobre la base
   actual: `oidc_subject` queda como dato histórico, `pending_user_requests` se elimina).
4. Validar en el ambiente desplegado: `/api/v1/health`; login del admin bootstrap; `GET /me`;
   RBAC contra una ruta `users.manage`; creación de un segundo usuario (p. ej. OLP_OPERATOR) con
   contraseña inicial; login de ese segundo usuario; `/auth/change-password`; Worker procesando
   colas (job_results/outbox); notificación Gmail de prueba; una importación y una descarga
   crítica. Keycloak continúa existiendo como recurso externo pero ya ningún servicio lo usa.

### Gate B — eliminar recursos obsoletos (solo después de un Gate A exitoso y observable)

1. Borrar del Dashboard: servicio `authorization-keycloak` y base `authorization-keycloak-db`
   (Render no los elimina por Auto Sync al desaparecer del yaml: la remoción es manual).
2. Verificar tras el borrado: Web, API y Worker siguen operativos; `/api/v1/health` en verde;
   login local y RBAC sin cambios.
3. Registrar el retiro en el runbook/issue del proyecto.

## Verificación previa a cualquier despliegue

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
docker compose up -d --build api worker web
render blueprints validate render.yaml
```

La última orden requiere Render CLI autenticado para las comprobaciones remotas (por ejemplo, disponibilidad de nombres o branch). La validación local contra `https://render.com/schema/render.yaml.json` comprueba únicamente estructura y tipos.
