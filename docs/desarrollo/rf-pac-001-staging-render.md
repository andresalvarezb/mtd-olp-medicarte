# RF-PAC-001 — aprovisionamiento temporal de staging en Render

**Estado:** configuración preparada, recursos no creados.
**Blueprint:** `render.staging.yaml`.
**Propósito:** validar release y flujos sintéticos aislados; no habilitar pacientes reales ni MTDOM.

## Decisiones de arquitectura

- Registrar `render.staging.yaml` como un **Blueprint nuevo** con path personalizado; no cambiar la asociación del Blueprint productivo al `render.yaml` raíz. Vincular el nuevo Blueprint a `develop` (o a un SHA/release aprobado), mantener desactivado el auto-sync del Blueprint y revisar manualmente cada sincronización. Usar deploy manual. Los servicios no fijan ramas propias y declaran `autoDeployTrigger: 'off'` para evitar deploy por cada commit.
- Render confirmó producción con API `1c-2g`, mientras que tanto `origin/master:render.yaml` como el `render.yaml` local declaran `0.5c-512mb`. Una sincronización del Blueprint productivo puede reducir el tamaño remoto. No sincronizar ni editar ese Blueprint como parte del staging. El archivo dedicado fija API staging a `1c-2g`, sin alterar la configuración productiva.
- Crear el proyecto `mtd-olp-medicarte-staging` y su entorno `RF-PAC-001`, con `networking.isolation: enabled` y `permissions.protection: enabled`. La definición dentro del archivo asigna los recursos nuevos a ese proyecto/entorno; el aislamiento bloquea tráfico privado cruzado, mientras las conexiones de los servicios dentro del entorno siguen permitidas.
- Recursos con nombres globalmente únicos y propios: `authorization-staging-web`, `authorization-staging-api`, `authorization-staging-worker`, `authorization-staging-db` y `authorization-staging-keyvalue`. Postgres y Key Value solo aceptan conexiones privadas (`ipAllowList: []`). API/web conservan URL pública HTTPS porque el navegador actual llama directamente a la API; el control de acceso depende de JWT, CORS, RBAC y gates. No se declara una red privada entre navegador y API.
- PostgreSQL está dedicado, versión 17, base `authorization_rf_pac_staging`, 5 GB de disco; Redis Key Value está dedicado, 256 MB, `noeviction` y persistencia `journal-snapshot`. Ninguna variable referencia recursos productivos.
- JWT se genera separadamente. Las tres contraseñas de bootstrap son `sync: false` y deben ser credenciales sintéticas nuevas provistas durante el alta; no poner valores en YAML. Omitir MIPRES, Sentry, Google Drive y MTDOM reales. No crear environment groups compartidos con producción.
- `PATIENT_MASTER_ACCESS_ENABLED`, `PATIENT_MASTER_SCOPE_POLICY_APPROVED` y `PATIENT_MASTER_DP07_APPROVED` quedan en `false`; versión vacía. MTDOM lookup/DP-07 también en `false`, sin token. No existe variable ni proveedor de feed global en este blueprint. Cualquier prueba positiva con endpoints de pacientes requiere un cambio temporal, aprobado, limitado a este entorno sintético y revocado al cierre; nunca cambiar defaults ni configuración productiva.
- El worker mantiene `SCHEDULER_ENABLED=true` únicamente para procesar outbox/BullMQ durante la ventana de pruebas. Por eso también ejecuta tareas generales del worker (incluida la revisión de vencimientos); el entorno debe contener únicamente registros sintéticos y el scheduler se apaga al terminar. Reconciliación y sincronización Google Drive están apagadas. El código actual no registra el scheduler de feed global de pacientes.

## Preview Environments

Render documenta Preview Environments desde workspace Pro o superior. La cuenta no tiene un plan verificado, así que no se presupone disponibilidad. El Blueprint productivo tampoco los habilita. Aunque sería técnicamente posible con un Blueprint configurado, no se recomienda activar previews automáticos: multiplican recursos/costo por PR, las variables `sync: false` no se copian y el predeploy configurado puede impedir que el preview use la rama PR. Para este RF queda preparada la opción de staging dedicado/manual, que usa el nuevo Blueprint y una sola base/Key Value aisladas. El archivo deja `previews.generation: off`.

## Builds y migraciones

Los tres Dockerfiles usan Node 22 Bookworm, instalan con pnpm congelado desde `pnpm-lock.yaml` y construyen el workspace requerido con `pnpm --filter @authorization/{api,worker,web}... build`; la web produce Next standalone. El build de API y worker incluye el paquete de base de datos y sus migraciones. El health check de API es `/api/v1/health`; el de web `/`; el worker es proceso sin health check HTTP.

El API staging es el único servicio con `preDeployCommand: node packages/database/dist/migrate.js`; worker no lo ejecuta. El migrador serializa con `pg_advisory_lock(hashtext('authorization-platform:migrations'))` y libera el lock en `finally`. El advisory lock protege frente a dos migradores concurrentes; no garantiza compatibilidad entre una versión vieja del worker y una migración que rompa su contrato. Por ello:

1. Desplegar API primero y esperar a que termine predeploy.
2. Verificar el journal aplicado desde el entorno staging privado hasta `0112_patient_master_read_permissions` (o el último tag aprobado del release).
3. Desplegar worker y luego web para el mismo SHA.
4. Mantener migraciones expand/contract; no retirar/renombrar columnas ni endurecer constraints mientras convivan versiones.
5. Si una migración no es compatible hacia atrás, detener worker antes de migrar y no ejecutar el E2E asíncrono hasta desplegar su versión compatible.

## Ejecución reproducible tras autorizar recursos

### A. Preflight de configuración

Desde la raíz del repo, sobre un SHA limpio y aprobado:

```powershell
pnpm exec prettier --check render.staging.yaml docs/desarrollo/rf-pac-001-staging-render.md
pnpm --filter @authorization/api... build
pnpm --filter @authorization/worker... build
pnpm --filter @authorization/web... build
```

Opcionalmente validar localmente las tres imágenes, si Docker está disponible:

```powershell
docker build -f infra/docker/api.Dockerfile -t rf-pac-stage-api:local .
docker build -f infra/docker/worker.Dockerfile -t rf-pac-stage-worker:local .
docker build -f infra/docker/web.Dockerfile -t rf-pac-stage-web:local .
```

No ejecutar las pruebas con `DATABASE_URL` apuntando a Render: el harness de integración de este repositorio tiene guardas de loopback y se debe mantener así. Las migraciones se ejecutan por el predeploy del API staging; verificar identidad del destino por el dashboard/metadata del recurso, el nombre `authorization_rf_pac_staging` y el entorno aislado antes de iniciar cualquier smoke de datos.

### B. Alta manual controlada

1. Requerir aprobación explícita del costo, workspace/entorno y duración. En Render, crear un Blueprint nuevo del repo y seleccionar exactamente el path `render.staging.yaml`; no sincronizar el Blueprint existente ni cambiar `render.yaml`. Mantener el auto-sync manual y las vistas previas apagadas.
2. Seleccionar `develop` como rama vinculada (o el SHA de release aprobado); comprobar que cada recurso tenga `autoDeployTrigger=off`, plan API `1c-2g`, nombres staging y ambiente `RF-PAC-001`.
3. Confirmar que el entorno está protegido y el bloqueo de tráfico privado entre entornos está habilitado. Comprobar Postgres/Key Value propios, allowlist vacía y ausencia de environment groups productivos.
4. Introducir únicamente contraseñas sintéticas nuevas para cuentas bootstrap. Confirmar que el secreto JWT fue generado por Render y no coincide/reutiliza uno productivo; no exportar ni copiar secretos a logs.
5. Iniciar despliegue manual en orden API → worker → web, al mismo SHA. Revisar build, health check y logs redactados; API debe aplicar migrations 0107–0112 antes de iniciar.

### C. Fixtures y pruebas

No reutilizar `infra/test-db/seed.sql`: es una carga de regresión operacional local y sus supuestos no definen staging. El seeder dedicado es `scripts/rf-pac-001-staging-fixtures.mjs`; no expone endpoint HTTP, no migra y solo atiende `inspect`, `seed` y `cleanup`. El API Dockerfile copia `/workspace` completo, incluidas `scripts/`, migraciones y el journal. El seeder exige que el ID de recurso Render pasado explícitamente coincida con el primer segmento del hostname PostgreSQL; además valida base/usuario dedicados, rechaza el ID productivo observado en la auditoría y comprueba migraciones `0107–0112` por timestamp **y hash** antes de abrir la transacción de escritura. La allowlist exacta del recurso Render solo se podrá completar después de que el recurso dedicado sea creado y verificado desde Render.

Fixtures por ejecución:

- 32 pacientes ficticios con tipo `TEST` y claves `SYN-*`, sin nombres ni documentos reales; 30 con autorizaciones enlazadas y dos con una identidad repetida para el caso ambiguo.
- 37 autorizaciones (34 enlazadas, 3 sin enlace: identidad ambigua, incompleta y ausente). La autorización conserva `source_data` sintético con `RF_PAC_FIXTURE_RUN` como correlación.
- Un paciente compartido entre MTD y MEDICARTE, con autorizaciones en dos puntos MEDICARTE; también hay pacientes MTD-only y MEDICARTE-only, incluidos registros dentro y fuera del punto concedido.
- Tres usuarios `TEST_FIXTURE` (MTD, MEDICARTE y OLP), tres roles `CUSTOM_*` exclusivos de la corrida y permisos otorgados solo a los dos primeros. El usuario MEDICARTE recibe un único grant al punto A; OLP no recibe `patient_master.read`.
- Las contraseñas sintéticas se suministran por variables de entorno temporales y se guardan únicamente como hash Argon2id. Nunca se imprimen ni se escriben en este repositorio.

#### Preflight y carga

No configurar una URL externa en las pruebas locales. La inspección de staging se ejecuta solo desde la shell privada de la API staging y después de comprobar visualmente en Render el proyecto `mtd-olp-medicarte-staging`, entorno `RF-PAC-001`, base `authorization_rf_pac_staging` y el ID `dpg-...` del recurso. Actualizar/confirmar antes la lista de IDs productivos en el script a partir de un inventario autorizado; nunca pasar el ID de producción.

```sh
# Solo en la shell privada del servicio API de staging. DATABASE_URL la inyecta
# Render desde authorization-staging-db; no copiar ni imprimir su valor.
node scripts/rf-pac-001-staging-fixtures.mjs inspect \
  --target render --allow-resource-id dpg-<ID-VERIFICADO-DE-STAGING>

# El operador provee tres contraseñas nuevas y aleatorias en la sesión privada;
# no pegarlas en argumentos, archivos, tickets ni logs. Deben durar solo esta prueba.
export RF_PAC_STAGING_FIXTURES_AUTHORIZED=YES
export RF_PAC_STAGE_MTD_PASSWORD='<secreto-sintetico-temporal>'
export RF_PAC_STAGE_MED_PASSWORD='<secreto-sintetico-temporal>'
export RF_PAC_STAGE_OLP_PASSWORD='<secreto-sintetico-temporal>'
node scripts/rf-pac-001-staging-fixtures.mjs seed \
  --target render --allow-resource-id dpg-<ID-VERIFICADO-DE-STAGING> \
  --run-id <UUID-NUEVO-DE-LA-VENTANA>
unset RF_PAC_STAGING_FIXTURES_AUTHORIZED RF_PAC_STAGE_MTD_PASSWORD \
  RF_PAC_STAGE_MED_PASSWORD RF_PAC_STAGE_OLP_PASSWORD
```

En PowerShell se usan `$env:...` y `Remove-Item Env:...`; no poner contraseñas literales en el historial. `seed` requiere `RF_PAC_STAGING_FIXTURES_AUTHORIZED=YES`. Repetir con el mismo UUID es idempotente; no volver a usar un run id que ya tenga evento `CLEANED`. La salida contiene solo IDs técnicos y conteos.

Para reproducir el test seeder local, primero comprobar que está usando el PostgreSQL aislado dedicado (sin ejecutar migraciones ni resets):

```powershell
pnpm.cmd db:test:verify
$env:TEST_DATABASE_URL = 'postgresql://mtd_test@127.0.0.1:55439/mtd_olp_medicarte_test'
node scripts/rf-pac-001-staging-fixtures.mjs inspect --target local `
  --allow-system-id <SYSTEM_IDENTIFIER_VERIFICADO> --database-url-env TEST_DATABASE_URL
$env:RF_PAC_STAGE_TEST_SYSTEM_ID = '<SYSTEM_IDENTIFIER_VERIFICADO>'
node --test scripts/rf-pac-001-staging-fixtures.test.mjs
Remove-Item Env:TEST_DATABASE_URL,Env:RF_PAC_STAGE_TEST_SYSTEM_ID
```

La identidad local exige loopback, puerto `55439`, base/usuario exactos, `data_directory` bajo `%LOCALAPPDATA%\mtd-olp-medicarte-test-db\pgdata` y `system_identifier` explícitamente permitido. Las contraseñas de la prueba se generan en memoria. El test limpia sus filas propias incluso ante fallo; conserva filas de alcance revocadas, usuarios/roles/puntos sintéticos inactivos y dos eventos de auditoría append-only.

#### E2E reproducible después de aprovisionar

1. Fijar el SHA aprobado en el Blueprint nuevo, verificar los cinco recursos staging y sus IDs, y desplegar manualmente API → worker → web con ese mismo SHA. API ejecuta el único `preDeployCommand`; esperar health check y confirmar `0107–0112` con la shell/read-only check antes de cualquier carga. No correr migraciones desde el seeder.
2. Ejecutar `inspect`; solo continuar si base, usuario, hostname, ID del recurso, esquema y hashes de migración coinciden. `inspect` no escribe. Ejecutar `seed` con run UUID nuevo y autorización temporal. Revisar conteos y IDs, nunca valores de URL o secretos.
3. **Bloqueo de gates actual:** el contrato de configuración trata `PATIENT_MASTER_SCOPE_POLICY_APPROVED` y `PATIENT_MASTER_DP07_APPROVED` como aprobaciones reales; si el endpoint está encendido exige ambos y una versión de política. No hay una modalidad test-only separada. Por tanto, con DP-07/RBAC funcionales aún pendientes no se debe marcar esas aprobaciones `true` para fingir una decisión ni habilitar la API. El smoke positivo de API/navegador queda bloqueado hasta que exista aprobación aplicable o un mecanismo de test sintético aislado, explícito y revisado; no cambiar defaults ni el Blueprint productivo.
4. Si ese bloqueo se resuelve explícitamente para staging sintético, iniciar sesión con cada uno de los tres sujetos generados y revisar `/me`. Ejecutar API HTTP real: MTD lista/busca/detalla; MEDICARTE puede consultar solo punto A; punto B devuelve 403 y un paciente sin autorización accesible no se revela por UUID; OLP obtiene 403; sin sesión 401. Revisar página 1/2 (25/5), búsqueda vacía, detalle y autorizaciones relacionadas. Comprobar que respuestas/logs no contienen claves sintéticas de identidad ni datos de usuario fuera de scope.
5. La prueba de punto compartido debe mostrar desde MEDICARTE solo su autorización de punto A aunque el mismo paciente tenga otra de punto B. MTD solo ve autorizaciones MTD; no hereda datos MEDICARTE. Contrastar respuestas HTTP con la base staging.
6. Para outbox/BullMQ, usar el flujo sintético autorizado que ya existe en el API/worker de staging y comprobar registro outbox → job de cola → resultado durable, duplicado, intento reintentable, terminal y recuperación. No pedir MTDOM real; lookup remoto debe seguir apagado. Registrar resultado con IDs/códigos técnicos, no payloads.
7. Una vez termine E2E, detener web/API/worker o retirar temporalmente los gates y reiniciar los procesos. Confirmar los tres flags de API en `false`, la versión vacía, worker con lookup/DP-07 false y sin token, feed global ausente y Redis sin jobs pendientes de esta corrida. Revocar la autorización temporal del operador y eliminar variables temporales de contraseña de la shell.

#### Limpieza controlada

La limpieza requiere autorización separada, el mismo ID de recurso verificado y el UUID exacto de la ejecución. Solo borra los IDs enumerados por su ledger de creación; valida propiedad de las filas y consulta las FK entrantes antes de borrar cada padre, en una transacción con bloqueo advisory. Elimina schedules, relaciones de organización, autorizaciones, pacientes, batch y período de esa corrida. Revoca el grant puntual, desactiva puntos/roles/usuarios y elimina sus password hashes. Conserva la fila de scope revocada y auditoría append-only. No ejecuta `TRUNCATE`, no borra por prefijo y no altera otros fixtures. Si aparece una referencia o dependencia operacional, aborta y revierte toda la limpieza; no quitar constraints ni borrar el recurso por SQL, revisar esa dependencia sintética antes de proseguir.

```sh
export RF_PAC_STAGING_FIXTURES_AUTHORIZED=YES
export RF_PAC_STAGING_FIXTURE_CLEANUP_AUTHORIZED=YES
node scripts/rf-pac-001-staging-fixtures.mjs cleanup \
  --target render --allow-resource-id dpg-<ID-VERIFICADO-DE-STAGING> \
  --run-id <UUID-EXACTO-DE-LA-CORRIDA>
unset RF_PAC_STAGING_FIXTURES_AUTHORIZED RF_PAC_STAGING_FIXTURE_CLEANUP_AUTHORIZED
```

El cierre debe confirmar el evento `..._CLEANED`, cero pacientes/autorizaciones de esos IDs, grants revocados, sujetos desactivados y ningún gate activo. El runbook no autoriza crear/eliminar recursos ni habilitar decisiones funcionales; esos pasos y el costo siguen requiriendo autorización explícita.

### D. Cierre y limpieza

1. Desactivar/verificar gates de pacientes; dejar MTDOM, feed global, conciliación, Drive y scheduler del worker apagados; detener el worker staging.
2. Retirar grants, usuarios y fixtures identificados por el run mediante reversión específica. No borrar eventos de auditoría append-only. Exportar evidencia sintética sanitizada.
3. Verificar que no queden listeners ni despliegues activos y que el API retorna gate cerrado.
4. Tras aprobación explícita de eliminación, verificar dos veces proyecto `mtd-olp-medicarte-staging`, entorno `RF-PAC-001` y exactamente los cinco recursos de staging; comprobar que ninguno de los IDs/servicios del blueprint productivo está seleccionado. Eliminar el entorno staging dedicado desde Render (lo cual elimina sus servicios y datastores) y confirmar su ausencia. No eliminar recursos por nombre parcial ni ejecutar una eliminación sobre el blueprint/proyecto productivo.

La creación, activación temporal de gates, provisión de secretos de staging y eliminación de recursos requieren autorización operativa/costo; no se ejecutan por haber preparado este archivo.

## Propuesta de incorporación a Git

Para generar un SHA desplegable, incorporar en una misma entrega funcional los cambios RF-PAC-001 de `packages/database` (schema, migraciones 0107–0112, journal y catálogo), `packages/contracts`, `packages/domain`, `packages/config`, API (`apps/api`), worker (`apps/worker`), UI (`apps/web`) y sus pruebas/regresiones. El bundle de preparación de staging añade `render.staging.yaml`, `scripts/rf-pac-001-staging-fixtures.mjs`, `scripts/rf-pac-001-staging-fixtures.test.mjs`, este runbook y el plan RF-PAC-001. Versionar los artefactos de esquema/catalogación juntos; no enviar únicamente el Blueprint o el seeder sin las migraciones y código que consumen.

Antes de producir un SHA para Render, revisar el diff acumulado y separar cualquier cambio no perteneciente al RF/staging (incluida documentación y pruebas locales preexistentes). No se hizo `git add`; todos los cambios locales permanecen intactos. La rama actual es de auditoría; cualquier PR de trabajo deberá partir de/incluir `origin/develop` y apuntar a `develop`, según `AGENTS.md`. No hay SHA remoto aprobado ni Render asociado a esta preparación.

## Capacidad y costo

| Recurso temporal                     | Plan                  | Precio público observado (USD/mes) |
| ------------------------------------ | --------------------- | ---------------------------------: |
| Web                                  | `0.5c-512mb`          |                                  7 |
| API                                  | `1c-2g`               |                                 25 |
| Worker                               | `0.5c-512mb`          |                                  7 |
| PostgreSQL                           | `0.5c-1g`, disco 5 GB |        19 + aprox. 1.20 de storage |
| Key Value                            | `256mb`               |                                 10 |
| **Total recursos a tiempo completo** |                       |                   **aprox. 69.20** |

Las tarifas de compute/Key Value/Postgres se verificaron en la tabla pública de Render consultada el 2026-11-07; el storage Postgres se calcula a $0.30/GB/mes sobre 1 GB incluido. Cobro se prorratea por segundo, por lo que el costo variable de 24 horas completas es aproximadamente $2.31; si el workspace debe pasar de Hobby a Pro, sumar la cuota mensual fija de $25 (por tanto, una prueba de un día en un mes de upgrade puede rondar $27.31, antes de pipeline extra, egress, impuestos u otros consumos). El workspace actual no se verificó. No se considera comprobado ningún costo real ni se consultó billing; confirmar el presupuesto en Render antes de crear recursos.
