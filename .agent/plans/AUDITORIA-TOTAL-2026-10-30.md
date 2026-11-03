# Auditoría total del sistema y plan de trabajo

- **Sistema:** MTD – OLP – Medicarte
- **Fecha de corte:** 2026-10-30 (America/Bogota)
- **Rama auditada:** `test/documentation-smoke-y-inventario-openapi`
- **Commit base:** `61aaa65c09215eb71432315456dc5c73082fc9e0`
- **Estado del árbol antes de crear este documento:** limpio
- **Naturaleza:** auditoría técnica local, estática y dinámica; no certifica producción

## 1. Dictamen ejecutivo

El núcleo funcional del checkout es consistente y tiene una base de pruebas fuerte:
lint, compilación de API/Web/Worker, 724 pruebas unitarias y 526 pruebas de
integración pasaron. El catálogo de base de datos también está sincronizado y el
`render.yaml` cumple el esquema JSON público actual de Render.

El sistema **no debe considerarse cerrado ni listo para una liberación sin
tratamiento adicional**. Se confirmaron cuatro grupos de bloqueo:

1. **Seguridad de cadena de suministro:** `pnpm audit --prod` reporta 60
   vulnerabilidades, incluidas 4 críticas y 27 altas. Hay exposición directa en
   Next.js, proxy/IP, subida de archivos y procesamiento de XLSX.
2. **Integraciones productivas ambiguas o incompletas en IaC:** MIPRES se declara
   para el Worker, pero la operación manual que consulta MIPRES vive en la API;
   Google Sheets/Drive, telemetría y reconciliación programada tampoco quedan
   completamente expresados en `render.yaml`.
3. **Brechas funcionales conocidas:** devoluciones posrecepción, novedades de
   traslado, liberación por no-show/vencimiento y ajustes por daño/merma siguen
   requiriendo decisiones de negocio. Los escenarios TE-01 a TE-105 no tienen
   certificación UAT completa.
4. **Preparación operativa incompleta:** no se verificaron despliegue, variables,
   migraciones, datos, backups, alertas ni recuperación en un entorno persistente.

La recomendación es ejecutar las olas P0 y P1 de este plan antes de declarar una
versión candidata a producción.

## 2. Alcance auditado

- Monorepo pnpm/Turbo: API NestJS, Web Next.js, Worker BullMQ, paquetes de
  configuración, contratos, dominio, base de datos y UI.
- 761 archivos versionados; 501 archivos TypeScript/TSX y 186.175 líneas TS/TSX.
- 104 archivos SQL de migración, 103 entradas efectivas en el journal Drizzle.
- Autenticación local JWT, RBAC, scopes por organización/punto y auditoría.
- PostgreSQL, Redis/Key Value, outbox, jobs, MIPRES, Google Drive/Sheets.
- Docker Compose local/integración, Dockerfiles, CI de GitHub y Blueprint Render.
- Documentación, ADR, requisitos, matrices operativas y planes históricos.

## 3. Evidencia ejecutada

| Comprobación                | Resultado del corte  | Observación                                                                                                  |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                 | PASS                 | Sin warnings ESLint.                                                                                         |
| `pnpm typecheck`            | PASS                 | 13 tareas Turbo; resultado servido desde caché.                                                              |
| Unitarias sin caché         | PASS con aislamiento | 724 pruebas. Una suite HTTP de 10 casos necesitó ejecución fuera del sandbox por `listen EPERM`; pasó 10/10. |
| Build API                   | PASS                 | `nest build`.                                                                                                |
| Build Worker                | PASS                 | `nest build`.                                                                                                |
| Build Web                   | PASS con aislamiento | Next.js 16.3.3 generó 33 rutas. El sandbox impedía el subprocess de TypeScript; fuera de él pasó.            |
| Integración                 | PASS                 | 46 archivos, 526 pruebas, PostgreSQL 17 y Redis aislados, migraciones reales y limpieza final.               |
| Catálogo DB                 | PASS                 | Test del generador y `db-schema-catalog.mjs --check`; 14 archivos.                                           |
| `pnpm format:check`         | FAIL                 | 299 archivos no cumplen Prettier.                                                                            |
| `pnpm audit --prod`         | FAIL                 | 60 vulnerabilidades: 4 críticas, 27 altas, 26 moderadas y 3 bajas.                                           |
| Esquema `render.yaml`       | PASS                 | Cero errores contra `https://render.com/schema/render.yaml.json`.                                            |
| Validación semántica Render | NO VERIFICADA        | `render blueprints validate` devolvió 401; requiere autenticación/workspace.                                 |
| GitHub Actions remoto       | NO VERIFICADO        | El token local de `gh` es inválido. La configuración local sí fue inspeccionada.                             |
| Producción/base persistente | NO VERIFICADO        | No se accedió a servicios, datos clínicos ni secretos reales.                                                |

## 4. Hallazgos priorizados

### 4.1 P0 — Bloqueadores de liberación

#### AUD-P0-01 — Dependencias de producción vulnerables

**Estado:** confirmado por registro npm el 2026-10-30.

`pnpm audit --prod` reportó:

- 4 críticas;
- 27 altas;
- 26 moderadas;
- 3 bajas.

Paquetes con mayor impacto:

| Paquete instalado           | Resultado                                | Exposición observada                                                                                           |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `next@16.3.3`               | 3 críticas, 2 altas, 5 moderadas, 1 baja | Web pública. El audit exige al menos una línea corregida que cubra todos los avisos, no solo el primer parche. |
| `proxy-addr@2.0.7`          | 1 crítica                                | API usa Express y `trust proxy = 1`; puede afectar identidad IP y throttling.                                  |
| `multer@2.0.2`              | 7 altas, 1 moderada, 1 baja              | Ocho flujos de carga usan `FileInterceptor`.                                                                   |
| `xlsx@0.18.5`               | 2 altas, sin parche npm reportado        | La API procesa XLSX aportados por usuarios en numerosos flujos.                                                |
| `zod@3.25.76`               | 1 alta                                   | Validación transversal de contratos y requests.                                                                |
| `drizzle-orm@0.44.5`        | 1 alta                                   | Persistencia API/Worker/Database.                                                                              |
| `body-parser@2.3.0`         | 1 alta                                   | Cadena HTTP de Express.                                                                                        |
| OpenTelemetry y transitivas | Altas/moderadas                          | Telemetría API; incluye `sdk-node`, gRPC e instrumentaciones no usadas directamente.                           |

Avisos críticos destacados: `GHSA-vcvr-r3jv-pc5j`,
`GHSA-2464-fhr4-w9xw`, `GHSA-673q-mjm6-r5xr` y
`GHSA-jqcg-44mw-7w3h`.

**Daño/riesgo:** RCE, DoS, spoofing de IP, agotamiento de recursos y
procesamiento inseguro de documentos. Aunque algunas rutas vulnerables puedan no
usarse hoy, la dependencia está en el artefacto de producción y varias superficies
son alcanzables.

**Tratamiento:** bloquear release; actualizar dependencias y lockfile, sustituir o
aislar `xlsx`, ejecutar regresión completa y exigir cero críticas/altas o una
excepción formal con fecha, dueño y controles compensatorios.

#### AUD-P0-02 — Integraciones de producción no están cerradas en el Blueprint

**Estado:** riesgo confirmado en IaC; estado vivo pendiente.

- `render.yaml` configura `MIPRES_BASE_URL`, `MIPRES_NIT` y
  `MIPRES_INITIAL_TOKEN` solo en `authorization-worker`.
- `MipresRecheckController` y `MipresRecheckService` se ejecutan en
  `authorization-api`. Sin esas variables, el recheck termina como
  `QUERY_ERROR`.
- La integración de cuota moderadora con Google Sheets se ejecuta en la API,
  pero el Blueprint no declara spreadsheet, pestaña ni archivo secreto de cuenta
  de servicio. El servicio degrada silenciosamente: guarda en BD, registra warning
  y no sincroniza Sheet; la factura permanece no disponible.
- La sincronización Drive vive en Worker y requiere configuración adicional no
  declarada en el Blueprint.
- Render preserva variables omitidas ya existentes, por lo que no se puede
  afirmar que producción esté rota sin inspeccionar el servicio vivo; sí se puede
  afirmar que el IaC no es autosuficiente.

**Tratamiento:** inventario de claves por servicio sin revelar valores, definición
de la fuente de verdad, secret files bajo `/etc/secrets`, prueba sintética de cada
integración y actualización del Blueprint/runbook.

#### AUD-P0-03 — Cuatro decisiones funcionales afectan integridad física

**Estado:** pendientes reconocidos en
`docs/casos-especiales/pendientes-funcionales-priorizados.md`.

- RF-01: devolución posrecepción a OLP.
- RF-02: faltante, merma o recepción parcial en traslado.
- RF-03: liberación de reserva por no-show/vencimiento.
- RF-04: ajuste manual por daño/vencimiento fuera de atención.

**Daño/riesgo:** resolver estos casos con SQL o pasos informales puede fabricar
stock, perder trazabilidad, duplicar consumo o romper la conciliación.

**Tratamiento:** decisión formal por MTD/OLP/Medicarte, modelo de estados y
movimientos compensatorios, permisos, doble aprobación donde corresponda,
idempotencia, auditoría y pruebas de concurrencia.

#### AUD-P0-04 — No existe certificación del entorno persistente

**Estado:** pendiente.

La base aislada pasa, pero no hay evidencia del SHA desplegado, migraciones
aplicadas, variables, jobs activos, conectividad externa, datos reconciliados,
backups o alertas en staging/producción.

**Tratamiento:** staging equivalente, migración sobre copia anonimizada, smoke por
actor, reconciliación, verificación de jobs y release checklist con rollback
forward.

### 4.2 P1 — Riesgos altos y deuda operativa

#### AUD-P1-01 — Archivo de migración huérfano y numeración duplicada

Existen dos archivos `0079_*`. El archivo
`0079_purchase_order_receipts_quantity_only.sql` no aparece en
`meta/_journal.json` y Drizzle no lo ejecuta. La corrección equivalente sí está en
`0092_purchase_order_receipts_quantity_only_fix.sql`.

**Riesgo:** revisión engañosa, aplicación manual accidental y divergencia entre
lo que parece existir y lo que migra realmente.

**Tratamiento:** confirmar historiales de bases persistentes; retirar/archivar el
huérfano sin editar migraciones aplicadas; crear gate que compare SQL, tags del
journal, prefijos e integridad de snapshots.

#### AUD-P1-02 — Backups, RPO/RTO y recuperación no están certificados

Hay utilidades locales de dump/restore, pero no se encontró un runbook versionado
de producción con RPO, RTO, retención, responsables, cifrado y prueba periódica de
restauración.

**Tratamiento:** definir política acorde al plan real de Render, ejecutar restore
en entorno aislado y registrar tiempos, validaciones e integridad posterior.

#### AUD-P1-03 — Reconciliación y observabilidad pueden estar desactivadas

- `RECONCILIATION_SCHEDULER_ENABLED` tiene default `false` y no está en
  `render.yaml`.
- `SENTRY_DSN` y `OTEL_EXPORTER_OTLP_ENDPOINT` tampoco están declaradas en IaC.
- Hay health check con DB/Redis y endpoint de métricas protegido, pero no evidencia
  de scraping, dashboards, alertas externas, dead-letter alerts o SLO.

**Tratamiento:** decisión explícita de habilitación, límites y alertas; no habilitar
autorreparación implícita. Probar caída de DB/Redis/MIPRES, backlog, DLQ y error
budget.

#### AUD-P1-04 — Sesión larga sin invalidación por cambio de contraseña

El JWT dura por defecto 28.800 segundos y se almacena en `sessionStorage`. La API
recarga usuario activo y permisos en cada request, lo cual revoca roles y usuarios,
pero un cambio de contraseña no invalida por sí mismo un token ya robado.

**Tratamiento:** incorporar `session_version`/`password_changed_at` verificable,
revocación de sesiones o TTL más corto con estrategia de renovación. Mantener la
revalidación de RBAC en PostgreSQL.

#### AUD-P1-05 — Hardening HTTP incompleto

No se observó `helmet`/CSP en la API ni política explícita equivalente para la Web.
Swagger/OpenAPI queda público también en producción. La CORS allowlist es de un
origen exacto y los logs redactan authorization/cookies, lo cual es positivo.

**Tratamiento:** CSP, HSTS/headers en una única capa autoritativa, protección o
desactivación de Swagger en producción, validación de tamaño/tipo/magic bytes y
pruebas de abuso.

#### AUD-P1-06 — Imágenes API/Worker sobredimensionadas

Los runners de API y Worker copian `/workspace` completo desde builder, incluidos
toolchain y dependencias de desarrollo. Esto aumenta imagen, superficie de ataque
y tiempos de despliegue. El Web sí usa salida `standalone`.

**Tratamiento:** runners mínimos con artefactos y dependencias de producción,
usuario no root conservado, base/digest controlados, SBOM y escaneo de imagen.

#### AUD-P1-07 — Falta UAT trazable de escenarios operativos

La suite automatizada pasa, pero las matrices documentales mantienen TE-01 a
TE-105 y varios casos T-\* como pendientes. No hay evidencia por entorno/commit y
actor real para el ciclo completo.

**Tratamiento:** mapear cada caso a test automatizado, UAT o decisión; eliminar
duplicados; registrar PASS/FAIL/BLOCKED, evidencia anonimizada y aprobador.

#### AUD-P1-08 — Gobierno de datos externos pendiente

La salida a Google Sheets puede incluir identificación del paciente, tipo de
documento, autorización, profesional, fecha e importe. La documentación reconoce
que faltan base legal, propietario, acceso, retención y eliminación.

**Tratamiento:** aprobación de privacidad/seguridad, minimización, ACL, retención,
auditoría de accesos, revocación y respuesta a incidentes antes de habilitar datos
reales.

#### AUD-P1-09 — Blueprint sin separación explícita de ambientes

El Blueprint es plano y no modela staging/production, previews, rama ni política
`autoDeployTrigger`. El esquema es válido, pero la validación semántica contra el
workspace no pudo ejecutarse por 401.

**Tratamiento:** decidir si el Dashboard o Blueprint es autoridad; declarar rama y
deploy tras checks; crear staging aislado; autenticar CLI y validar conflictos,
planes y recursos existentes antes de sincronizar.

### 4.3 P2 — Calidad, mantenibilidad y gobierno

#### AUD-P2-01 — Contrato de formato roto

`pnpm format:check` falla en 299 archivos y no se ejecuta en CI.

**Tratamiento:** definir baseline/ignore para generados, aplicar formato en PR
separado y activar gate para archivos nuevos/modificados antes de formatear todo el
monorepo.

#### AUD-P2-02 — No hay cobertura cuantitativa ni umbrales

No se encontró configuración de coverage/threshold. Worker y `packages/ui` no
tienen unitarias propias; los comportamientos principales del Worker sí reciben
cobertura indirecta de integración.

**Tratamiento:** cobertura por riesgo, no solo porcentaje; umbrales progresivos,
tests directos de timers, reintentos, DLQ, shutdown, Drive y fallos externos.

#### AUD-P2-03 — Módulos monolíticos de alto riesgo de cambio

Ejemplos:

- `purchase-order-import.service.ts`: 6.313 líneas;
- `authorization-query.repository.ts`: 5.802;
- `consulta-autorizaciones-view.tsx`: 5.470;
- `purchase-order.repository.ts`: 4.329;
- `schema.ts`: 4.208;
- `receipt.repository.ts`: 3.030.

**Tratamiento:** modularizar por caso de uso/transacción/read model, manteniendo
tests de caracterización y límites de dominio. No hacer refactor masivo junto con
cambios funcionales P0.

#### AUD-P2-04 — CI sin gates de seguridad y release

CI ejecuta build, lint, tipos, unitarias e integración, pero no ejecuta audit,
formato, coverage, secret scan, SAST, SBOM, escaneo de imagen ni validación Render.
Las Actions usan tags mayores (`@v4`) y no SHA inmutable.

**Tratamiento:** añadir gates gradualmente, Renovate/Dependabot, permisos mínimos,
timeouts/concurrency y pinning de Actions.

#### AUD-P2-05 — Gobierno del repositorio incompleto

No se encontraron `SECURITY.md`, `CODEOWNERS`, política de actualización de
dependencias, licencia, `.nvmrc`/`.node-version` o runbook de incidentes. CI y
Docker usan Node 22, pero el engine acepta cualquier Node `>=22`.

**Tratamiento:** pin operativo de Node 22 LTS, política de soporte, owners,
divulgación de vulnerabilidades y documentación de incidentes/releases.

#### AUD-P2-06 — Evidencia documental quedó un caso atrás

La documentación de cierre registra 45 archivos/525 pruebas de integración; el
corte actual ejecutó 46/526. La diferencia es pequeña, pero confirma que los
totales manuales envejecen.

**Tratamiento:** generar el resumen de pruebas y OpenAPI en CI con SHA y fecha;
evitar cifras manuales sin artefacto reproducible.

### 4.4 P3 — Mejoras recomendadas

- Probar accesibilidad, navegación por teclado y contrastes con tooling automático
  y UAT.
- Medir rendimiento de consultas y XLSX con volúmenes reales anonimizados.
- Definir budgets de bundle, tamaño de imagen, tiempo de build y tiempo de arranque.
- Añadir pruebas de caos controlado para Redis, MIPRES, Sheets/Drive y deploy
  durante jobs activos.
- Revisar internacionalización, mensajes y consistencia de fechas/zonas horarias.

## 5. Controles positivos observados

- Validación Zod extensiva y TypeScript estricto.
- Contraseñas Argon2id, secreto JWT con mínimo de entropía, issuer/audience y
  algoritmo fijado.
- Usuario y permisos se recargan desde PostgreSQL en cada request.
- CORS restringido a `WEB_ORIGIN`; secretos sensibles redactados de logs HTTP.
- Transacciones, advisory locks, idempotencia, outbox, auditoría y pruebas de
  concurrencia en flujos críticos.
- Health check valida PostgreSQL y Redis; métricas requieren permiso.
- Contenedores de producción ejecutan como usuario `node`.
- `.env`, credenciales y carpeta `secrets/` están ignoradas; no se detectaron
  secretos reales versionados mediante la inspección estática realizada.
- Integración usa puertos/proyecto/volúmenes aislados y limpia al terminar.
- Catálogo de base de datos tiene gate de coherencia.

## 6. Límites de esta auditoría

No se ejecutaron:

- acceso a producción o staging persistente;
- consulta de migraciones efectivamente aplicadas en Render;
- inspección de variables o secretos vivos;
- GitHub Actions remoto, por credencial local inválida;
- validación semántica/conflictos de Render, por respuesta 401;
- pentest, DAST, escaneo de contenedores o infraestructura;
- revisión legal, clínica, contable o de privacidad por responsables humanos;
- UAT con operadores reales y datos sintéticos aprobados;
- prueba real contra MIPRES, Google Drive o Google Sheets.

Por tanto, `PASS` local no equivale a certificación de despliegue, seguridad o
operación.

## 7. Plan de trabajo

### Principios de ejecución

1. No mezclar upgrades de seguridad, refactor grande y reglas de negocio en un
   solo PR.
2. Cada ola conserva migraciones forward-only y evidencia reproducible.
3. Las decisiones RF requieren aprobación funcional antes de implementación.
4. Ninguna prueba usa datos clínicos reales.
5. Todo cierre incluye SHA, entorno, comandos, resultados y responsable.

### Ola 0 — Contención y baseline de release (P0)

| ID    | Tarea                                                                                                                          | Responsable sugerido   | Dependencias      | Criterio de salida                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------- | --------------------------------------------------------- |
| W0-01 | Declarar el corte actual no liberable por vulnerabilidades críticas/altas.                                                     | Tech Lead / Release    | Ninguna           | Release checklist registra bloqueo y dueño.               |
| W0-02 | Crear rama/PR de hardening desde el baseline aceptado; confirmar si los 24 commits sobre `origin/develop` forman el candidato. | Tech Lead              | W0-01             | Base y alcance aprobados; CI remoto visible.              |
| W0-03 | Guardar artefacto JSON de audit, SBOM inicial y lista de imágenes/dependencias.                                                | DevSecOps              | W0-01             | Evidencia versionada fuera de secretos y asociada al SHA. |
| W0-04 | Inventariar configuración viva por servicio y migraciones aplicadas, sin extraer valores secretos.                             | DevOps / DBA           | Acceso autorizado | Matriz esperado/real y drift clasificado.                 |
| W0-05 | Confirmar si MIPRES, Sheets/Drive, reconciliación y telemetría son obligatorios para el release.                               | Producto / Operaciones | W0-04             | Decisión por integración con dueño y SLA.                 |

### Ola 1 — Remediación de seguridad de dependencias (P0)

| ID    | Tarea                                                                                                                                   | Complejidad | Criterio de salida                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| W1-01 | Actualizar Next a una versión que cubra todos los advisories reportados, no solo el mínimo de uno.                                      | M           | Build, rutas y pruebas Web PASS; audit sin avisos Next críticos/altos.                                        |
| W1-02 | Actualizar Nest/Express y transitivas: proxy-addr, Multer, body-parser, qs, file-type, path-to-regexp.                                  | L           | Uploads, throttling/IP, errores y límites PASS; advisories cerrados.                                          |
| W1-03 | Actualizar Drizzle y ejecutar migraciones/integración/concurrencia.                                                                     | M           | Schema, queries, migrator y 526+ integraciones PASS.                                                          |
| W1-04 | Migrar Zod 3 a versión corregida, con inventario de breaking changes.                                                                   | L           | Contratos/API/Web PASS; límites de colecciones probados.                                                      |
| W1-05 | Resolver `xlsx`: evaluar versión mantenida, fuente soportada o librería sustituta; aislar parsing y limitar recursos mientras se migra. | XL          | Ningún XLSX no confiable pasa por dependencia vulnerable sin excepción formal; fixtures y exportaciones PASS. |
| W1-06 | Actualizar OpenTelemetry y demás transitivas; eliminar instrumentaciones innecesarias del artefacto.                                    | M           | Telemetría arranca y audit reduce avisos transitivos.                                                         |
| W1-07 | Añadir `pnpm audit --prod` y política de excepciones al CI.                                                                             | S           | CI bloquea nuevas críticas/altas.                                                                             |

### Ola 2 — Despliegue, secretos e integraciones (P0/P1)

| ID    | Tarea                                                                                                   | Criterio de salida                                                       |
| ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| W2-01 | Definir Blueprint/Dashboard como fuente de verdad y autenticar Render CLI en el workspace correcto.     | `render blueprints validate` PASS, sin sincronizar cambios no aprobados. |
| W2-02 | Declarar MIPRES en API y Worker según consumidores reales; rotar/proveer secretos por mecanismo seguro. | Recheck sintético controlado no queda `QUERY_ERROR` por configuración.   |
| W2-03 | Configurar Sheets/Drive con secret file de Render y variables por servicio.                             | Escritura/lectura sintética PASS; no hay secreto en imagen/log.          |
| W2-04 | Decidir y declarar reconciliación programada, Sentry y OTEL.                                            | Jobs, métricas y alertas se observan en staging.                         |
| W2-05 | Declarar rama, `autoDeployTrigger: checksPass`, staging/production y aislamiento.                       | Ningún deploy productivo ocurre antes de gates.                          |
| W2-06 | Optimizar Dockerfiles API/Worker y fijar base reproducible.                                             | Imágenes mínimas, usuario no root, SBOM y scan sin crítico/alto.         |
| W2-07 | Ejecutar smoke autenticado por MTD/OLP/Medicarte y prueba negativa sin token.                           | HTTP esperado, datos sintéticos, evidencia por SHA.                      |

### Ola 3 — Integridad de datos y continuidad (P0/P1)

| ID    | Tarea                                                                  | Criterio de salida                                                            |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| W3-01 | Auditar el historial de migraciones de todas las bases persistentes.   | Tabla por entorno: SHA app, journal aplicado, drift y acciones.               |
| W3-02 | Resolver el `0079` huérfano y añadir gate de linaje.                   | SQL y journal 1:1 o excepciones documentadas; CI falla ante duplicados.       |
| W3-03 | Definir RPO, RTO, retención, cifrado y responsables de backup.         | Política aprobada y compatible con el plan real de PostgreSQL.                |
| W3-04 | Restaurar backup en entorno aislado y validar reconciliación/smoke.    | Restore drill PASS con tiempos y checklist.                                   |
| W3-05 | Ejecutar migración y regresión sobre copia anonimizada representativa. | Sin pérdida, constraints/fks válidos y reconciler sin hallazgos no aceptados. |

### Ola 4 — Decisiones funcionales e implementación (P0/P1)

| ID    | Alcance                       | Secuencia obligatoria                                                                      |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| W4-01 | RF-01 devolución posrecepción | Decisión → ADR/requisito → modelo compensatorio → permisos/audit → pruebas → UAT.          |
| W4-02 | RF-02 novedad en traslado     | Decisión sobre parcial/faltante/merma/reclamo → movimientos → cierre → UAT.                |
| W4-03 | RF-03 no-show/vencimiento     | Política farmacéutica y operativa → lote/reuso → no doble consumo → worker/API → UAT.      |
| W4-04 | RF-04 ajuste daño/vencimiento | Motivos → evidencia/doble aprobación → ledger → conciliación → UAT.                        |
| W4-05 | RF-05 a RF-09                 | Priorizar reversión, contabilidad, MIPRES, producto preparado y matriz RBAC después de P0. |
| W4-06 | Matrices TE/T-\*              | Mapear a automatizado/UAT/decisión; ejecutar y firmar los casos aplicables.                |

### Ola 5 — Hardening de identidad y HTTP (P1)

| ID    | Tarea                                                                            | Criterio de salida                                                         |
| ----- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| W5-01 | Invalidar tokens por cambio/reset de contraseña y cierre administrativo.         | Token anterior recibe 401; cambios de rol/activo siguen siendo inmediatos. |
| W5-02 | Revisar TTL, renovación y almacenamiento de sesión.                              | Threat model aprobado; XSS no expone sesión sin controles compensatorios.  |
| W5-03 | Añadir CSP y headers; decidir Swagger/OpenAPI productivo.                        | Escaneo de headers PASS y docs no revelan superficie sin política.         |
| W5-04 | Fortalecer uploads: MIME/magic bytes, límites de hojas/celdas/compresión/tiempo. | Corpus malicioso no agota memoria/CPU y produce error seguro.              |
| W5-05 | Ejecutar SAST, secret scan y DAST autenticado por roles.                         | Sin findings críticos/altos abiertos o excepción aprobada.                 |

### Ola 6 — Calidad y mantenibilidad (P2)

| ID    | Tarea                                                           | Criterio de salida                                                       |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| W6-01 | Crear estrategia de formato incremental y luego baseline total. | `pnpm format:check` PASS y corre en CI.                                  |
| W6-02 | Habilitar coverage por paquete y riesgo.                        | Umbrales progresivos; Worker y seguridad con cobertura directa.          |
| W6-03 | Extraer casos de uso de los archivos >2.500 líneas.             | PR pequeños, tests de caracterización y sin cambio funcional simultáneo. |
| W6-04 | Pin de Node 22 LTS y reproducción local/CI/Docker.              | Misma versión y builds reproducibles.                                    |
| W6-05 | Añadir Renovate/Dependabot, CODEOWNERS y SECURITY.md.           | Owners y cadencia de parches operativos.                                 |
| W6-06 | Automatizar OpenAPI, catálogo DB y resumen de pruebas por SHA.  | Documentación no depende de contadores manuales.                         |

### Ola 7 — Certificación final

Ejecutar en este orden:

1. instalación congelada y verificación de supply-chain;
2. lint, formato, typecheck sin caché, unitarias sin caché y coverage;
3. build de todos los artefactos e imágenes;
4. migraciones desde cero y desde copia anonimizada;
5. integración completa y pruebas de concurrencia;
6. DAST/security matrix por rol y scope;
7. smoke staging con MIPRES/Sheets/Drive sintéticos;
8. restore drill y reconciliación;
9. UAT funcional firmado;
10. validación Render autenticada, deploy tras checks y smoke post-deploy.

## 8. Gates obligatorios para declarar cierre

- `pnpm install --frozen-lockfile` PASS.
- `pnpm audit --prod`: cero críticas/altas sin excepción vigente.
- `pnpm lint`, `pnpm format:check` y typecheck sin caché PASS.
- Unitarias, integración y cobertura PASS.
- Build API/Web/Worker e imágenes PASS.
- Journal/migraciones/catálogo sin drift.
- Render schema y validación semántica PASS.
- Configuración viva coincide con matriz esperada.
- Backup/restore y reconciliación PASS.
- MIPRES/Sheets/Drive prueban éxito y degradación controlada.
- RF P0 decididos e implementados o explícitamente excluidos del release.
- UAT y seguridad aprobados con evidencia por SHA.
- No se usan datos clínicos reales en pruebas ni artefactos compartidos.

## 9. Orden recomendado inmediato

```text
W0-01 bloqueo de release
  -> W0-02 baseline y CI remoto
  -> W1 seguridad de dependencias
  -> W0-04/W0-05 drift e integraciones
  -> W2 staging/IaC/observabilidad
  -> W3 migraciones + restore
  -> W4 decisiones funcionales P0
  -> W5 hardening
  -> W6 calidad/refactor
  -> W7 certificación final
```

Las olas W1, W0-04/W0-05 y la preparación de decisiones RF pueden avanzar en
paralelo, pero ninguna habilita producción por sí sola.

## 10. Definition of Done global

El sistema se considera auditado y cerrado únicamente cuando no quedan P0/P1 sin
decisión, la cadena de suministro no presenta vulnerabilidades críticas/altas sin
excepción vigente, el entorno persistente coincide con el IaC aprobado, se ha
probado restauración, las integraciones externas funcionan con datos sintéticos,
los casos operativos aplicables tienen UAT y el release queda asociado a un SHA y
evidencia reproducible.
