# Configuración de runtime en Render

Este inventario contrasta `render.yaml` con los esquemas de
[`@authorization/config`](../packages/config/src/index.ts) y sus consumidores en
API y Worker. Es la configuración declarativa propuesta; no confirma la
configuración de servicios existentes ni aplica cambios al Dashboard. No
sincronizar Blueprints ni desplegar como parte de esta preparación local.

## Regla de configuración

- El Blueprint conserva valores estables y no sensibles, referencias entre
  servicios y toggles seguros.
- Credenciales y archivos de cuenta se cargan en **Render Dashboard → Service →
  Environment**. Los IDs Google son específicos por entorno y se completan allí,
  sin incluir sus valores en Git.
- Render pregunta por claves `sync: false` durante la creación inicial del
  Blueprint. Al sincronizar uno ya existente, omite esas claves: agregar una
  clave nueva a `render.yaml` no la crea ni actualiza en el servicio vivo. Se
  debe añadir manualmente en el Dashboard y luego verificar que el servicio la
  recibió.
- Para el archivo de cuenta Google, cargar en cada servicio que lo consume el
  Secret File `google-service-account.json`. El contenedor lo lee desde
  `/etc/secrets/google-service-account.json`, según el path estable declarativo.

Ver [Blueprint YAML Reference](https://render.com/docs/blueprint-spec) y
[Environment Variables and Secrets](https://render.com/docs/configure-environment-variables)
para las limitaciones actuales de `sync: false` y Secret Files.

## Matriz por servicio

| Servicio               | Variable                                                                                                        | Fuente en Blueprint                           | Acción / estado esperado                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authorization-api`    | `DATABASE_URL`, `REDIS_URL`                                                                                     | Referencias `fromDatabase` y `fromService`    | Se resuelven dentro del workspace Render.                                                                                                                    |
| `authorization-api`    | `NODE_ENV`, `LOG_LEVEL`, `PORT`, `API_PUBLIC_URL`, `WEB_ORIGIN`                                                 | Valores declarados y URL externa referenciada | Estables; confirmar que `WEB_ORIGIN` coincide con el dominio del entorno antes del deploy.                                                                   |
| `authorization-api`    | `AUTH_JWT_SECRET`                                                                                               | `generateValue: true`                         | Render genera el valor si falta; verificar presencia sin mostrarlo y preservar la clave existente.                                                           |
| `authorization-api`    | `AUTH_BOOTSTRAP_ADMIN_PASSWORD`, `AUTH_BOOTSTRAP_MTD_GENERAL_PASSWORD`, `AUTH_BOOTSTRAP_MTD_AUDITORIA_PASSWORD` | `sync: false`                                 | Ingresar manualmente cuando aplique la configuración bootstrap. No usar contraseñas reales en ejemplos ni logs.                                              |
| `authorization-api`    | `MIPRES_BASE_URL`                                                                                               | URL declarada                                 | Valor estable del servicio MIPRES.                                                                                                                           |
| `authorization-api`    | `MIPRES_NIT`, `MIPRES_INITIAL_TOKEN`                                                                            | `sync: false`                                 | Ingresar los valores autorizados para el entorno desde el Dashboard.                                                                                         |
| `authorization-api`    | `RECONCILIATION_SCHEDULER_ENABLED`                                                                              | `false`                                       | Mantener deshabilitado explícitamente hasta decisión y certificación operativa.                                                                              |
| `authorization-api`    | `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE`                                                                             | `/etc/secrets/google-service-account.json`    | Cargar el archivo de cuenta por Dashboard; comprobar presencia y permisos, sin copiar el contenido a evidencia.                                              |
| `authorization-api`    | `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_IDS`                                                                            | `sync: false`                                 | Configurar solo raíces aprobadas. El código también suma la clave singular histórica si existe; revisar ambas para evitar raíces antiguas.                   |
| `authorization-api`    | `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID`                                                                             | No declarada; compatibilidad histórica        | Render puede conservarla en servicios existentes. Revisar su valor en Dashboard y validar si sigue autorizado; el consumidor la combina con la lista plural. |
| `authorization-api`    | `GOOGLE_SHEETS_MODERATOR_FEE_ID`                                                                                | `sync: false`                                 | Configurar el ID de spreadsheet aprobado y autorizado para la cuenta de servicio.                                                                            |
| `authorization-api`    | `GOOGLE_SHEETS_MODERATOR_FEE_SHEET_NAME`                                                                        | Default de código: `PRUEBAS`                  | Si Operaciones requiere otra pestaña, definirla por Dashboard y registrar solo el nombre, nunca credenciales ni IDs.                                         |
| `authorization-api`    | `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                     | No declaradas                                 | Opcionales. No habilitar hasta que Operaciones confirme necesidad, destino y valores por entorno.                                                            |
| `authorization-worker` | `DATABASE_URL`, `REDIS_URL`                                                                                     | Referencias `fromDatabase` y `fromService`    | Se resuelven dentro del workspace Render.                                                                                                                    |
| `authorization-worker` | `NODE_ENV`, `LOG_LEVEL`                                                                                         | Valores declarados                            | Estables.                                                                                                                                                    |
| `authorization-worker` | `SCHEDULER_ENABLED`                                                                                             | `true`                                        | Mantenerlo activo: gobierna despacho de outbox y barrido de vencimientos del Worker. No equivale al scheduler de reconciliación.                             |
| `authorization-worker` | `GOOGLE_DRIVE_AUDIT_SYNC_ENABLED`                                                                               | `false`                                       | Mantener deshabilitada la sincronización periódica de Drive.                                                                                                 |
| `authorization-worker` | `MIPRES_BASE_URL`                                                                                               | URL declarada                                 | Valor estable compartido. El Worker recibe el esquema común, aunque el recheck identificado se ejecuta en API.                                               |
| `authorization-worker` | `MIPRES_NIT`, `MIPRES_INITIAL_TOKEN`                                                                            | `sync: false`                                 | Ingresar los valores autorizados para el entorno desde el Dashboard.                                                                                         |
| `authorization-worker` | `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE`                                                                             | `/etc/secrets/google-service-account.json`    | Cargar el mismo nombre de Secret File, con permisos mínimos para las carpetas aprobadas.                                                                     |
| `authorization-worker` | `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_IDS`                                                                            | `sync: false`                                 | Configurar solo raíces aprobadas. El código también suma la clave singular histórica si existe; revisar ambas para evitar raíces antiguas.                   |
| `authorization-worker` | `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID`                                                                             | No declarada; compatibilidad histórica        | Render puede conservarla en servicios existentes. Revisar su valor en Dashboard y validar si sigue autorizado; el consumidor la combina con la lista plural. |
| `authorization-worker` | `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                     | No declaradas                                 | Opcionales; esperar decisión de Operaciones.                                                                                                                 |

## Toggles y límites de la revisión

- `GOOGLE_DRIVE_AUDIT_SYNC_ENABLED=false` detiene el job periódico de Drive en
  Worker. La búsqueda bajo demanda de soportes desde API es una ruta separada y
  depende de sus credenciales e IDs.
- `SCHEDULER_ENABLED=true` conserva tareas operativas actuales del Worker.
- `RECONCILIATION_SCHEDULER_ENABLED=false` mantiene apagado el scheduler de
  reconciliación en API. La preparación no autoriza autocorrección de datos.
- No se debe copiar a este repo ningún secreto, contenido de Secret File, NIT,
  token MIPRES ni ID de Google específico de un entorno.
- La matriz de nombres y asignaciones es comprobable localmente. No se consultó
  Render Dashboard, no se probó conectividad externa y no se verificó la
  presencia de claves o archivos en servicios existentes.

## Verificación antes de cerrar AUD-P0-02

1. Validar el esquema local de `render.yaml` y comprobar los nombres declarados
   por servicio contra esta matriz y los consumidores de configuración.
2. En un staging aislado autorizado, verificar desde el Dashboard la presencia
   de cada clave requerida, sin copiar ni mostrar su valor.
3. Verificar por separado API y Worker: secret file presente, IDs correctos,
   mínimos permisos, MIPRES disponible y toggles observados con sus estados
   esperados. Revisar ambas variables `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID` y
   `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_IDS`: el consumidor combina sus valores y
   Render puede conservar variables históricas omitidas.
4. Ejecutar las pruebas sintéticas de MIPRES, Sheets y Drive, incluyendo una
   degradación controlada, y guardar evidencia asociada al SHA candidato.

El checklist de liberación conserva AUD-P0-02 abierto hasta tener evidencia de
staging y aprobación del responsable.

### Resultado local — 2026-11-03

`render.yaml` se parseó con PyYAML y pasó el esquema JSON público de Render con
cero errores. También pasaron las comprobaciones locales de asignación de claves
y toggles descritas arriba. `render blueprints validate render.yaml` llegó a la
API de Render y respondió `401 Unauthorized`; la validación semántica contra un
workspace y la configuración viva siguen pendientes.
