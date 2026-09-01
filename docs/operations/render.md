# Despliegue preparado para Render

## Alcance

`render.yaml` declara todos los recursos del Blueprint, pero crear o sincronizar el Blueprint sigue siendo una acción manual fuera del repositorio. La región `virginia` usada por el Blueprint está aprobada por ADR-017/DEC-009; antes de sincronizar, revisar únicamente los planes y costos.

| Recurso                     | Tipo Render              | Imagen/configuración                             | Región     |
| --------------------------- | ------------------------ | ------------------------------------------------ | ---------- |
| `authorization-web`         | Web Service Docker       | `infra/docker/web.Dockerfile`                    | `virginia` |
| `authorization-api`         | Web Service Docker       | `infra/docker/api.Dockerfile`                    | `virginia` |
| `authorization-worker`      | Background Worker Docker | `infra/docker/worker.Dockerfile`                 | `virginia` |
| `authorization-keycloak`    | Web Service Docker       | `infra/docker/keycloak.Dockerfile`               | `virginia` |
| `authorization-keyvalue`    | Render Key Value         | `noeviction`, `journal-snapshot`, acceso privado | `virginia` |
| `authorization-db`          | Render PostgreSQL 17     | base principal, acceso privado                   | `virginia` |
| `authorization-keycloak-db` | Render PostgreSQL 17     | base exclusiva de Keycloak, acceso privado       | `virginia` |

Render no ofrece región Colombia. La región de producción aprobada en ADR-017/DEC-009 es Virginia, USA: `virginia` mantiene juntos todos los recursos y satisface esa decisión. La residencia y el procesamiento de servicios, bases de datos y datos administrados por Render en Virginia quedan expresamente aceptados; la ausencia de región Colombia no bloquea producción.

## Red y puertos

- API escucha en `0.0.0.0:(PORT ?? API_PORT ?? 3001)`. Render fija `PORT=10000`; Compose conserva `API_PORT=3001`.
- Web standalone escucha en `HOSTNAME:PORT`. Render fija `0.0.0.0:10000`; Compose fija `0.0.0.0:3000` y publica `127.0.0.1:3002`.
- Worker usa `NestFactory.createApplicationContext`; no crea servidor HTTP ni consume `PORT`.
- Keycloak recibe `PORT=10000` y `KC_HTTP_PORT=10000`. Render termina TLS; Keycloak acepta HTTP interno con `KC_HTTP_ENABLED=true` y procesa `X-Forwarded-*` con `KC_PROXY_HEADERS=xforwarded`.
- El health check de API es `GET /api/v1/health` y comprueba API, PostgreSQL y Key Value. Keycloak conserva health en su interfaz de administración `:9000`; Render usa su comprobación TCP para no publicar ese endpoint.

## Migraciones

El build de API ejecuta `pnpm --filter @authorization/api... build`. El selector incluye `@authorization/database`, cuyo `tsc` genera `packages/database/dist/migrate.js`. La imagen final copia también `packages/database/migrations`, por lo que el comando de producción es:

```bash
node packages/database/dist/migrate.js
```

`authorization-api` y `authorization-worker` usan ese comando como `preDeployCommand`. Ambos planes declarados son pagados y ambas imágenes incluyen el artefacto. El migrador obtiene `DATABASE_URL` mediante una referencia `fromDatabase` y usa un advisory lock de PostgreSQL para serializar despliegues concurrentes antes de iniciar cada nueva instancia.

## Keycloak reproducible

La imagen está fijada en Keycloak `26.3` por digest, se optimiza para PostgreSQL durante el build y copia `infra/keycloak/realm-export.json` a `/opt/keycloak/data/import/realm-export.json`. El proceso inicia con `start --optimized --import-realm`.

El realm usa placeholders de variables de entorno para el origen Web, el secret del cliente administrativo y las contraseñas iniciales. Compose suministra únicamente credenciales locales conocidas; Render genera las cuatro contraseñas de Keycloak con `generateValue: true`, fija el usuario bootstrap declarativamente y referencia en Keycloak el secret que vive en API. Keycloak omite el import si el realm ya existe: cambios posteriores al JSON o a las contraseñas de usuarios importados requieren un procedimiento controlado mediante Admin API o una importación con Keycloak detenido, no se aplican por reiniciar el servicio.

Las URLs `*.onrender.com` del Blueprint derivan de los nombres declarados. Antes del primer Blueprint, comprobar que esos nombres estén disponibles. Si se adoptan dominios personalizados, hay que actualizar `KC_HOSTNAME`, los issuer, `API_PUBLIC_URL`, `WEB_ORIGIN` y los `NEXT_PUBLIC_*`; Web debe reconstruirse porque Next.js embebe `NEXT_PUBLIC_*` durante `next build`.

## Variables de Web

"Pública" significa que el valor queda incluido en el JavaScript del navegador. Las demás variables pueden contener valores no secretos, pero no se publican por el mecanismo `NEXT_PUBLIC_*`.

| Variable                     | Consumidor                                    | Fase            | Pública | Secreta | Origen en Render                     |
| ---------------------------- | --------------------------------------------- | --------------- | ------- | ------- | ------------------------------------ |
| `NEXT_PUBLIC_API_URL`        | `apps/web/lib/config.ts` y cliente REST       | Build           | Sí      | No      | URL pública de API con `/api/v1`     |
| `NEXT_PUBLIC_OIDC_ISSUER`    | `apps/web/lib/config.ts` y autenticación OIDC | Build           | Sí      | No      | issuer público de Keycloak           |
| `NEXT_PUBLIC_OIDC_CLIENT_ID` | autenticación OIDC Web                        | Build           | Sí      | No      | `authorization-web`                  |
| `NODE_ENV`                   | Next.js/Node                                  | Build y runtime | No      | No      | Imagen: `production`                 |
| `HOSTNAME`                   | servidor standalone de Next.js                | Runtime         | No      | No      | `0.0.0.0`                            |
| `PORT`                       | servidor standalone de Next.js                | Runtime         | No      | No      | `10000` en Render; `3000` en Compose |

`NEXT_PUBLIC_OIDC_URL` y `NEXT_PUBLIC_OIDC_REALM` no existen: el único nombre canónico es `NEXT_PUBLIC_OIDC_ISSUER`.

## Variables de API

Todas son runtime. `packages/config/src/index.ts` valida el conjunto al arrancar.

| Variable                               | Consumidor/efecto                                         | Pública | Secreta | Configuración Render                              |
| -------------------------------------- | --------------------------------------------------------- | ------- | ------- | ------------------------------------------------- |
| `NODE_ENV`                             | modo producción, proxy confiable y módulos no productivos | No      | No      | `production`                                      |
| `LOG_LEVEL`                            | logger Pino                                               | No      | No      | `info`                                            |
| `DATABASE_URL`                         | pool PostgreSQL y migrador pre-deploy                     | No      | Sí      | `authorization-db.connectionString`               |
| `REDIS_URL`                            | IORedis/BullMQ                                            | No      | Sí      | `authorization-keyvalue.connectionString`         |
| `OIDC_ISSUER`                          | validación del issuer JWT                                 | No      | No      | issuer HTTPS público de Keycloak                  |
| `OIDC_AUDIENCE`                        | validación del audience JWT                               | No      | No      | `authorization-api`                               |
| `OIDC_JWKS_URL`                        | descarga de JWKS; vacío usa `OIDC_ISSUER`                 | No      | No      | Omitida, usa fallback público                     |
| `OIDC_ADMIN_ISSUER`                    | token endpoint del cliente administrativo                 | No      | No      | issuer HTTPS público de Keycloak                  |
| `OIDC_ADMIN_CLIENT_ID`                 | cliente service account de Keycloak                       | No      | No      | `authorization-admin`                             |
| `OIDC_ADMIN_CLIENT_SECRET`             | credencial del cliente service account                    | No      | Sí      | `sync: false`; Keycloak referencia el mismo valor |
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

Todas son runtime y ninguna es pública. El worker no consume `PORT`.

| Variable                               | Consumidor/efecto                                   | Secreta | Configuración Render                      |
| -------------------------------------- | --------------------------------------------------- | ------- | ----------------------------------------- |
| `NODE_ENV`                             | entorno Sentry/configuración                        | No      | `production`                              |
| `LOG_LEVEL`                            | logger Pino                                         | No      | `info`                                    |
| `DATABASE_URL`                         | pool PostgreSQL                                     | Sí      | `authorization-db.connectionString`       |
| `REDIS_URL`                            | BullMQ/IORedis                                      | Sí      | `authorization-keyvalue.connectionString` |
| `OIDC_ISSUER`                          | obligatoria por schema común; sin consumidor Worker | No      | issuer público de Keycloak                |
| `OIDC_AUDIENCE`                        | obligatoria por schema común; sin consumidor Worker | No      | `authorization-api`                       |
| `OIDC_JWKS_URL`                        | opcional por schema; sin consumidor Worker          | No      | Omitida                                   |
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

## Variables de Keycloak

Todas son runtime salvo `KC_DB` y `KC_HEALTH_ENABLED`, que también se fijan durante el build optimizado. Ninguna se expone mediante el bundle Web.

| Variable                               | Consumidor/efecto                                      | Secreta | Configuración Render                     |
| -------------------------------------- | ------------------------------------------------------ | ------- | ---------------------------------------- |
| `PORT`                                 | puerto esperado por Render                             | No      | `10000`                                  |
| `KC_HTTP_PORT`                         | listener HTTP de Keycloak                              | No      | `10000`, igual a `PORT`                  |
| `KC_HTTP_ENABLED`                      | HTTP interno tras terminación TLS                      | No      | `true`                                   |
| `KC_PROXY_HEADERS`                     | interpretación de `X-Forwarded-*`                      | No      | `xforwarded`                             |
| `KC_HOSTNAME`                          | URL frontend/issuer externo                            | No      | URL HTTPS pública de Keycloak            |
| `KC_DB`                                | proveedor de base                                      | No      | `postgres`                               |
| `KC_DB_URL_HOST`                       | host PostgreSQL Keycloak                               | No      | referencia a `authorization-keycloak-db` |
| `KC_DB_URL_PORT`                       | puerto PostgreSQL Keycloak                             | No      | referencia a `authorization-keycloak-db` |
| `KC_DB_URL_DATABASE`                   | nombre de base Keycloak                                | No      | referencia a `authorization-keycloak-db` |
| `KC_DB_USERNAME`                       | usuario PostgreSQL Keycloak                            | No      | referencia a `authorization-keycloak-db` |
| `KC_DB_PASSWORD`                       | password PostgreSQL Keycloak                           | Sí      | referencia a `authorization-keycloak-db` |
| `KC_HEALTH_ENABLED`                    | health de interfaz management                          | No      | Imagen: `true`                           |
| `KC_BOOTSTRAP_ADMIN_USERNAME`          | usuario admin inicial del realm master                 | No      | Fijo: `mtd-keycloak-admin`               |
| `KC_BOOTSTRAP_ADMIN_PASSWORD`          | password admin inicial                                 | Sí      | `generateValue: true`                    |
| `WEB_ORIGIN`                           | placeholder de redirect URI/origin del realm importado | No      | URL pública de Web                       |
| `OIDC_ADMIN_CLIENT_SECRET`             | placeholder del cliente `authorization-admin`          | Sí      | referencia al secreto solicitado por API |
| `KEYCLOAK_FOUNDATION_ADMIN_PASSWORD`   | password inicial del usuario de fundación              | Sí      | `generateValue: true`                    |
| `KEYCLOAK_OLP_OPERATOR_PASSWORD`       | password inicial del operador OLP                      | Sí      | `generateValue: true`                    |
| `KEYCLOAK_MEDICARTE_OPERATOR_PASSWORD` | password inicial del operador Medicarte                | Sí      | `generateValue: true`                    |

## Variables auxiliares locales y de pruebas

| Servicio/contexto  | Variable                                                   | Consumidor                | Secreta                                 |
| ------------------ | ---------------------------------------------------------- | ------------------------- | --------------------------------------- |
| PostgreSQL Compose | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`        | imagen oficial PostgreSQL | Password: sí, solo valor local conocido |
| MIPRES mock        | `PORT`                                                     | listener mock             | No                                      |
| MIPRES mock        | `MIPRES_MOCK_INITIAL_TOKEN`, `MIPRES_MOCK_OPERATIVE_TOKEN` | mock local                | Sí, solo valores locales conocidos      |
| Integración        | `API_URL`, `KEYCLOAK_URL`, `DATABASE_URL`                  | gates `tests/integration` | `DATABASE_URL`: sí                      |

## Valores solicitados al crear el Blueprint

- `OIDC_ADMIN_CLIENT_SECRET`, ingresado una vez en API y referenciado por Keycloak.
- `MIPRES_NIT` y `MIPRES_INITIAL_TOKEN`.
- `GMAIL_SENDER`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_PRIVATE_KEY`.

Keycloak ya no solicita valores en el Blueprint: `KC_BOOTSTRAP_ADMIN_USERNAME` es declarativo (`mtd-keycloak-admin`) y las cuatro contraseñas (`KC_BOOTSTRAP_ADMIN_PASSWORD`, `KEYCLOAK_FOUNDATION_ADMIN_PASSWORD`, `KEYCLOAK_OLP_OPERATOR_PASSWORD`, `KEYCLOAK_MEDICARTE_OPERATOR_PASSWORD`) se generan con `generateValue: true`.

Los secretos solicitados son `OIDC_ADMIN_CLIENT_SECRET`, las credenciales MIPRES y `GOOGLE_PRIVATE_KEY`. Los nombres de usuario/cuentas y remitente no son secretos, pero se solicitan porque dependen del ambiente y no deben inventarse en el Blueprint.

Render genera y referencia automáticamente passwords de ambas bases y la cadena de conexión de Key Value; no deben introducirse manualmente ni copiarse al repositorio.

## Recuperación de un Blueprint parcialmente creado

`sync: false` solo se solicita durante la creación inicial del Blueprint; un sync posterior lo ignora. Si la creación inicial falla a mitad, los recursos creados después del fallo pueden quedar sin esos valores y el Blueprint no los volverá a pedir: se recuperan ingresándolos manualmente en el servicio correspondiente desde el Dashboard (así se repusieron `OIDC_ADMIN_CLIENT_SECRET` en API y las variables MIPRES/Gmail del Worker).

Para secretos que no dependen de un valor externo, la alternativa soportada es `generateValue: true`: Render genera un valor aleatorio de 256 bits codificado en base64 al crear el recurso, lo persiste en el servicio y lo reutiliza en syncs y deploys posteriores. El valor nunca queda en Git, no se hardcodea y sigue siendo recuperable desde Dashboard → servicio → Environment (revelar/copiar). Keycloak resuelve los placeholders `${...}` de `infra/keycloak/realm-export.json` desde el entorno del contenedor durante el import; los caracteres base64 generados (`A-Za-z0-9+/=`) no rompen el JSON.

Una vez generado el valor, el Blueprint no lo regenera ni lo sobreescribe en syncs ulteriores. Las contraseñas de usuarios del realm se aplican solo en el primer arranque (Keycloak omite el import si el realm ya existe), por lo que cambiar la variable no cambia credenciales existentes: la rotación se hace vía Admin Console (Users → Credentials → Reset password) o `kcadm set-password -r authorization --username <user>`. El usuario bootstrap (`mtd-keycloak-admin`) es temporal y se re-crea en cada arranque a partir de `KC_BOOTSTRAP_ADMIN_*`, así que actualizar su `generateValue` en el Dashboard y redeployar restablece también una vía de acceso administrativo de recuperación.

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
