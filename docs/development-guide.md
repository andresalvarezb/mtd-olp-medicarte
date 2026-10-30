# Desarrollo, ejecución y controles de calidad

**Corte de código:** checkout `feat/purchase-order-authorization-reassignment` @
`3627564` (2026-10-29).

## Requisitos

- Git y Bash (Git Bash en Windows).
- Node.js `>=22` y Corepack; el manifiesto raíz fija pnpm `11.24.0`.
- Docker Engine/Desktop con Docker Compose.
- Puertos locales libres según `.env.local` (valores por defecto abajo).

## Entorno de desarrollo con recarga de código

Ejecutar desde la raíz del repositorio:

```bash
corepack enable
pnpm install --frozen-lockfile
bash scripts/local.sh up
```

`local.sh` crea `.env.local` a partir del ejemplo si está ausente. El servicio
`dev` de `docker-compose.local.yml` ejecuta `pnpm install`, `db:migrate` y
`turbo dev` en el contenedor; monta el repositorio y dispone polling para
Docker Desktop/Windows. Revise las variables antes de ponerlo en marcha.

| Recurso | Predeterminado | Configuración |
| --- | --- | --- |
| Web | `http://localhost:3002` | `WEB_HOST_PORT` |
| API | `http://localhost:3001/api/v1` | `API_HOST_PORT` |
| PostgreSQL | `127.0.0.1:15432` | `POSTGRES_HOST_PORT` |
| Redis | `127.0.0.1:16379` | `REDIS_HOST_PORT` |
| MIPRES mock | `127.0.0.1:18090` | `MIPRES_MOCK_HOST_PORT` |

Operaciones habituales:

```bash
bash scripts/local.sh status
bash scripts/local.sh logs dev
bash scripts/local.sh config
bash scripts/local.sh doctor
bash scripts/local.sh down
```

**Atención:** `bash scripts/local.sh reset` ejecuta `docker compose down -v` y
elimina los volúmenes del proyecto local. No se requiere para actualizar
documentación ni debe utilizarse sobre datos no respaldados.

La variante `scripts/dev-local.sh` usa una base shadow con nombre predeterminado
específico. Es otro procedimiento; no debe tratarse como sinónimo del contenedor
`dev` ni ejecutarse contra una base real sin revisar la URL de conexión.

## Variables y secretos

- `.env.example`: ejemplo genérico para procesos independientes.
- `.env.local.example`: puertos y opciones del entorno local Docker.
- `AUTH_JWT_SECRET`: obligatorio para autenticación. Nunca registrar secretos
  reales, credenciales MIPRES o tokens en repositorios ni tickets.
- `AUTH_BOOTSTRAP_ADMIN_*`: creación del administrador local inicial;
  las contraseñas de ejemplo **no son aptas para producción**.
- `DATABASE_URL` y `REDIS_URL`: apuntar al entorno correcto antes de migrar.
- `DATABASE_POOL_MAX`: pool PostgreSQL del API, defecto 4, rango 1–20.
- `SCHEDULER_ENABLED`: activa procesamiento/tareas del worker cuando corresponde.
- `RECONCILIATION_SCHEDULER_ENABLED`: control independiente para programación de
  reconciliación.

### Google Sheets opcional para cuota moderadora

`ModeratorFeeSheetService` usa la cuenta de servicio indicada en
`GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE`. Para habilitarlo localmente, crear `secrets/`
y guardar el JSON fuera de Git en `secrets/google-service-account.json`, otorgar acceso de Sheets
solo al spreadsheet previsto al correo de esa cuenta y configurar en `.env.local`
`GOOGLE_SHEETS_MODERATOR_FEE_ID` y, si se necesita, la pestaña
`GOOGLE_SHEETS_MODERATOR_FEE_SHEET_NAME`. El ejemplo local deja el ID vacío;
sin ID o sin archivo de credenciales el recaudo se conserva en PostgreSQL,
pero no se exporta a Sheets. El servicio `dev` ve el archivo por el montaje del
repositorio; el perfil `api` monta el directorio de credenciales en modo de solo lectura. El contexto
de construcción Docker excluye `secrets/`; Git también lo ignora. Compose puede
crear el directorio del host si falta, pero eso no crea el JSON ni impide que
arranque la API. Si se configura un ID y falta el archivo, `appendRow` registra
una advertencia al intentar exportar y la consulta de factura devuelve `null`.
El servicio busca primero la ruta configurada (también relativa al directorio
de trabajo); si no existe, prueba `secrets/google-service-account.json` como
fallback. Revisar ambos lugares antes de habilitar un spreadsheet real.

El código y ambos Compose dejan vacío el ID y usan `PRUEBAS` como pestaña
predeterminada. Para usar otra pestaña o un spreadsheet real hay que
configurarlos explícitamente. La escritura pide `spreadsheets` y la consulta de la URL de
factura pide `spreadsheets.readonly`. Verificar que la cuenta tenga acceso al
spreadsheet y que el archivo JSON sea legible dentro del contenedor. No copiar
credenciales, identificaciones de pacientes ni URLs reales a documentación o
fixtures. El proceso externo puede tardar aproximadamente un minuto en llenar
`Print factura`; el usuario reintenta la consulta manualmente.

## Migraciones

```bash
pnpm db:migrate
```

Ese comando necesita `DATABASE_URL` hacia la base que se desea migrar; **no**
ejecutarlo por accidente contra producción. `scripts/local.sh up` ya incluye
migración dentro de su servicio `dev`. El historial de control contiene 103
entradas hasta `0103_mtd_moderator_fee_permission` al corte documental; esto no prueba
que hayan sido aplicadas a una base concreta.

## Calidad

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

El script `pnpm test` ejecuta suites Turbo y el escaneo de uso legacy.
Integración tiene su propio Docker Compose y requiere PostgreSQL y Redis.
Consultar `scripts/run-integration.mjs`, `scripts/setup-integration.mjs` y
`.github/workflows/ci.yml` para el procedimiento preciso de CI.

**Cobertura de CI:** el workflow contiene `pull_request` y `push` sobre
`master`/`main`. No hay un trigger explícito `push` sobre `develop`. Por tanto,
no interpretar un push a `develop` como evidencia automática de ejecución del CI.

## Diagnóstico mínimo

1. `bash scripts/local.sh status`: revisar salud de `dev`, Postgres y Redis.
2. `bash scripts/local.sh logs dev`: inspeccionar errores de migración,
   bootstrap, servidor web o worker.
3. `GET /api/v1/health`: comprobar respuesta del API, distinguiendo salud del
   proceso de disponibilidad funcional de módulos.
4. Métricas de pool: revisar conexiones total/idle/busy/waiting en la métrica
   `authorization_api_database_pool_connections` por un usuario con permiso.
5. Comparar migraciones ejecutadas con journal; un error SQL `42P01` puede
   indicar una tabla no creada en el entorno, no un fallo del controlador.

## Reglas de cambios de documentación

- Cambiar solo archivos `.md` salvo autorización expresa para ajustar código.
- Acompañar las afirmaciones funcionales con una ruta de código o ADR.
- Separar **implementado**, **diseñado** y **validado en integración**.
- Antes del commit: comprobar enlaces, diff, formato Markdown y encabezados.
- Para merge: ejecutar los gates adecuados en el equipo/CI; no reportar PASS
  sin su salida real.
