# Authorization Platform

Plataforma monorepo para gestionar autorizaciones, validaciones PBS/NO PBS,
MIPRES, Anexo Tarifario, disponibilidad, dispensación, auditoría y
notificaciones.

## Requisitos

- Node.js `>=22`.
- Corepack habilitado.
- Docker y Docker Compose.
- Puertos locales disponibles: `3001`, `3002`, `6379` y `15432`.

## Instalación Inicial

Ejecutar desde la raíz del proyecto:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Crear el archivo de entorno:

```bash
cp .env.example .env
```

En desarrollo con Docker Compose, los valores definidos en `docker-compose.yml`
son suficientes para levantar la plataforma.

## Levantar Todo El Proyecto

Esta es la secuencia recomendada. Construye las imágenes, inicia PostgreSQL,
Redis y el mock de MIPRES, ejecuta las migraciones y levanta API, Worker y Web:

```bash
docker compose up -d --build
docker compose ps
```

Verificar los servicios:

```bash
curl http://localhost:3001/api/v1/health
curl -I http://localhost:3002
```

URLs locales:

- Web: <http://localhost:3002>
- API: <http://localhost:3001>
- Swagger/OpenAPI: <http://localhost:3001/api/v1/docs>
- OpenAPI JSON: <http://localhost:3001/api/v1/openapi.json>
- PostgreSQL: `localhost:15432`
- Redis: `localhost:6379`

Ver logs:

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web
```

Detener los servicios sin eliminar datos:

```bash
docker compose down --remove-orphans
```

No usar `-v` para detenerlos si se desea conservar PostgreSQL, Redis, usuarios,
credenciales y datos operativos.

## Levantar Sin Reconstruir

Si las imágenes ya fueron construidas y no hubo cambios de código:

```bash
docker compose up -d
```

Si hubo cambios de código, usar siempre:

```bash
docker compose up -d --build
```

## Migraciones

La migración se ejecuta automáticamente cuando API y Worker se levantan con
Docker Compose. El servicio `migrate` ejecuta:

```bash
node packages/database/dist/migrate.js
```

Para ejecutarla manualmente con el entorno local:

```bash
pnpm db:migrate
```

Migraciones relevantes:

- `0014_tariff_annex.sql`: tablas, permisos y membresía del Anexo Tarifario.
- `0015_tariff_annex_source_fields.sql`: campos comerciales del Anexo Tarifario.

Las migraciones usan PostgreSQL como fuente de verdad y un bloqueo advisory para
evitar ejecuciones concurrentes.

## Reset Operativo Conservando Usuarios

Este comando elimina los datos operativos, autorizaciones, importaciones,
Anexo Tarifario, staging, jobs, outbox, notificaciones y auditorías.

Conserva:

- `users` y sus credenciales locales.
- `organizations`.
- `roles`.
- `permissions`.
- `role_permissions`.
- `user_organization_roles`.
- Plantillas y destinatarios de notificaciones.

Ejecutar:

```bash
pnpm db:reset
```

El script exige la confirmación `--yes`, ya incluida en el comando raíz.
También puede ejecutarse directamente:

```bash
pnpm --filter @authorization/database db:reset --yes
```

Después del reset, si los contenedores están levantados, no es necesario
recrear las imágenes. Para comprobar el estado:

```bash
docker compose ps
docker compose logs --tail=100 api worker
```

El reset no elimina ni cambia las credenciales de los usuarios. En desarrollo,
la cuenta inicial se configura con `AUTH_BOOTSTRAP_ADMIN_USERNAME` y
`AUTH_BOOTSTRAP_ADMIN_PASSWORD`; el bootstrap es idempotente y no sobrescribe
una contraseña existente.

## Reset Completo Incluyendo Usuarios

Esta operación elimina también las credenciales y todos los datos de PostgreSQL
y Redis. Usarla únicamente cuando se quiera comenzar desde cero:

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

`-v` elimina los volúmenes `postgres-data` y `redis-data`.

## Cuenta Inicial De Desarrollo

Con la configuración incluida en Docker Compose:

```text
Usuario: foundation-admin
Contraseña: foundation-admin
```

Cambiar esta contraseña fuera de entornos locales. Nunca usar estas credenciales
en Render o producción.

## Anexo Tarifario

Ruta web:

```text
Configuración > Anexo Tarifario
```

El cargue masivo acepta únicamente XLSX (`.xlsx`) con estos encabezados exactos:

```text
Codigo Medicamento
Tarifa de la unidad
Número de Expediente del INVIMA
Consecutivo INVIMA (Presentación)
Descripción Genérica del Medicamento (DCI)
Descripción Comercial del Medicamento
Laboratorio del Medicamento
Tipo de Inclusion del Medicamento (PBS/NOPBS)
```

Mapeo a PostgreSQL:

```text
Codigo Medicamento                         -> codigo_producto
Tarifa de la unidad                       -> tarifa_unidad
Número de Expediente del INVIMA           -> numero_expediente_invima
Consecutivo INVIMA (Presentación)         -> consecutivo_invima_presentacion
Descripción Genérica del Medicamento      -> descripcion_generica
Descripción Comercial del Medicamento     -> descripcion_comercial
Laboratorio del Medicamento               -> laboratorio
Tipo de Inclusion del Medicamento         -> tipo_inclusion
```

El cruce contra autorizaciones usa únicamente:

```text
authorization_items.codigo_medicamento
        VS
tariff_annex_products.codigo_producto
```

## Archivo De Autorizaciones

El único formato admitido es XLSX (`.xlsx`). Para que una fila sea procesable, el archivo
debe incluir como mínimo estos encabezados:

```text
NUMERO_AUTORIZACION
COD_COMERCIAL
ESTADO_AUTORIZACION
No.PRESCRIPCION
```

El contrato completo vigente reconoce además:

```text
CODEPS
NUMERO_AUTORIZACION
TIP_DOCUMENTO
NUM_DOCUMENTO
NOMBRE_PACIENTE
NUMERO_TELEFONO
COD_CUPS_PRINCIPAL
CUPS_PRINCIPAL
COD_COMERCIAL
CUMS
NIT_PRESTADOR
NOMBRE_PRESTADOR
COD_CUPS_AUTORIZADO
CUPS_AUTORIZADO
CANTIDAD
DOSIS
FECHA_ASIGNACION
FECHA_FINAL_VIGENCIA
ESTADO_AUTORIZACION
No.PRESCRIPCION
OBS_AUTORIZACION
MEDICO_REMITENTE
CMNT
_Id
FPRO
VALOR CUOTA MODERADORA
CPRG
CDGN001
```

`COD_COMERCIAL` se normaliza y se almacena como `codigo_medicamento`.
`No.PRESCRIPCION` vacío clasifica la autorización como `PBS`; un valor
numérico de más de tres dígitos clasifica como `NO_PBS`.

`CPRG` se conserva como evidencia interna, pero nunca aparece en las bases
descargadas. `CDGN001` sí aparece en las descargas.

## Orden De Las Descargas

Las bases de autorizaciones descargadas comienzan siempre con:

```text
id
NUMERO_AUTORIZACION
NUM_DOCUMENTO
NOMBRE_PACIENTE
CDGN001
COD_COMERCIAL
CUPS_AUTORIZADO
CANTIDAD
DOSIS
FECHA_ASIGNACION
FECHA_FINAL_VIGENCIA
VALOR CUOTA MODERADORA
No.PRESCRIPCION
```

Después se agregan los campos generados durante el flujo:

```text
authorization_key
enablement_status
coverage_type
direction_status
operation_status
lugar_dispensacion
fecha_dispensacion
fecha_aplicacion
cod_autorizacion_medicarte
audit_status
application_site_status
operational_version
version
created_at
updated_at
```

El campo `id` corresponde al UUID generado por PostgreSQL para el registro de
`authorization_items`.

## Pruebas Y Calidad

Lint:

```bash
pnpm lint
```

Typecheck:

```bash
pnpm typecheck
```

Tests unitarios:

```bash
pnpm test
```

Tests de integración. Requieren API, Worker, PostgreSQL, Redis y mock MIPRES
levantados:

```bash
pnpm test:integration
```

Build completo:

```bash
pnpm build
```

Comprobación recomendada antes de desplegar:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

## Desarrollo Local

Para levantar únicamente las dependencias:

```bash
docker compose up -d postgres redis mipres-mock
pnpm db:migrate
```

En otra terminal, iniciar las aplicaciones:

```bash
pnpm dev
```

La opción recomendada para reproducir el entorno completo es Docker Compose,
porque garantiza que API, Worker, Web, Redis, PostgreSQL y las migraciones usen
la misma configuración.

## Render

Render utiliza Docker para API, Worker y Web. Cada servicio ejecuta la migración
como `preDeployCommand`. No se deben ejecutar resets en producción.

Antes de desplegar:

1. Ejecutar la secuencia completa de calidad.
2. Verificar que `DATABASE_URL` y `REDIS_URL` apunten a los servicios de Render.
3. Confirmar que `AUTH_JWT_SECRET` y la contraseña bootstrap sean secretos de
   Render.
4. Verificar que MIPRES y Gmail estén configurados únicamente en el Worker.
5. Confirmar el backup de PostgreSQL.

El Anexo Tarifario se inicia vacío en una instalación nueva; MTD debe cargar los
productos desde la interfaz administrativa.

## Estructura

```text
apps/api       API NestJS y OpenAPI
apps/worker    BullMQ, Outbox, importaciones y notificaciones
apps/web       Interfaz Next.js
packages/config
packages/contracts
packages/database
packages/domain
packages/ui
tests/integration
infra/docker
```
