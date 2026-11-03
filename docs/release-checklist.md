# Checklist de liberación

- **Sistema:** MTD – OLP – Medicarte
- **Corte auditado:** `61aaa65c09215eb71432315456dc5c73082fc9e0`
- **Rama auditada:** `test/documentation-smoke-y-inventario-openapi`
- **Fecha del bloqueo:** 2026-10-30 (America/Bogota)
- **Estado:** **BLOQUEADO — NO LIBERABLE A PRODUCCIÓN**
- **Responsable del bloqueo y su seguimiento:** Administrador del sistema
- **Evidencia fuente:** [Auditoría total del sistema y plan de trabajo](../.agent/plans/AUDITORIA-TOTAL-2026-10-30.md)
- **Aprobación del registro:** pendiente de revisión del Administrador del sistema en el PR

## 1. Alcance del bloqueo

El corte identificado no debe aprobarse como release ni promoverse a producción.
El bloqueo no impide el desarrollo, las pruebas locales ni los despliegues de
validación autorizados en staging aislado.

Este registro no desactiva por sí mismo un despliegue automático. Cualquier
contención operativa necesaria debe confirmarse por el canal autorizado, sin
registrar secretos ni datos clínicos en este documento.

Los resultados citados proceden de una auditoría local sobre el SHA indicado.
No certifican el estado de producción ni se transfieren automáticamente a otro
commit.

### Evidencia posterior de P0.1 — 2026-11-03

La siguiente evidencia corresponde al árbol de trabajo basado en
`61aaa65c09215eb71432315456dc5c73082fc9e0`, con cambios locales sin commit. No
es evidencia asociada a un SHA candidato limpio.

- `pnpm install --frozen-lockfile`: PASS en la instalación limpia de la suite de
  integración, con Node 22 y pnpm 11.24.0; lockfile vigente con 742 entradas.
- `pnpm audit --prod --audit-level=high`: PASS; `No known vulnerabilities found`.
- `pnpm build`: PASS local con Node 24.18.0; Web descargó Poppins de Google
  Fonts durante la compilación.
- `pnpm lint`: PASS.
- `pnpm typecheck --force`: PASS, 13 tareas sin caché.
- `pnpm test`: PASS, 724 pruebas y escaneo legacy; además, `pnpm exec turbo test
  --force` pasó las 13 tareas con cero tareas cacheadas.
- `pnpm test:integration`: PASS, 46 archivos y 526 pruebas con PostgreSQL 17,
  Redis y migraciones reales en entorno temporal. Las imágenes API y Worker se
  compilaron con Node 22.

AUD-P0-01 permanece pendiente de cierre hasta asociar los gates a un SHA limpio
y obtener el resultado de CI configurado con Node 22. Esta evidencia local no
libera el sistema ni sustituye la aprobación del responsable.

### Preparación local de AUD-P0-02/03/04 — 2026-11-03

El avance se preparó sobre el commit base local `b13a1ea` y comprende:

- **AUD-P0-02:** `render.yaml` declara MIPRES también en API, las claves de Drive
  y Sheets por servicio y los toggles acordados. La
  [matriz de runtime](render-runtime-configuration.md) documenta los valores
  manuales y la limitación de `sync: false` en servicios existentes. La
  configuración viva de Render y las integraciones siguen sin verificar.
- **AUD-P0-03:** el
  [registro de decisiones funcionales](decisiones-funcionales-p0.md) prepara
  alternativas, efectos de inventario/facturación, controles y firmas para
  RF-01 a RF-04. No hay aprobaciones registradas ni cambios de producto; todas
  las RF permanecen abiertas.
- **AUD-P0-04:** el
  [runbook de certificación de staging](runbooks/certificacion-staging.md)
  define captura de SHA/imágenes, migraciones, variables, jobs, integraciones
  sintéticas, backup/restore, reconciliación y rollback. Es una guía sin
  ejecución: no existe evidencia de despliegue ni restore drill en staging.

### Validación local posterior a integración — 2026-11-03

Antes de crear el commit de integración con `develop`, se ejecutaron estos
gates sobre el árbol local:

- `pnpm audit --prod --audit-level=high`: PASS, sin vulnerabilidades conocidas.
- `pnpm build`: PASS, 8 paquetes del workspace.
- `pnpm lint`: PASS.
- `pnpm exec turbo typecheck --force`: PASS, 13 tareas sin caché.
- `pnpm test`: PASS, 739 pruebas Vitest en API, dominio, Web y paquetes; pasan
  también los escáneres legacy y 8 pruebas Node de seguridad de integración.
- `pnpm test:integration`: PASS, 46 suites y 526 pruebas contra PostgreSQL 17 y
  Redis efímeros, con migraciones reales y limpieza confirmada de recursos.
- El YAML pasó el esquema JSON público actual de Render con cero errores. La
  validación semántica del CLI respondió `401 Unauthorized`; falta acceso al
  workspace Render autorizado.

GitHub CI aún debe ejecutarse sobre el SHA limpio del commit de integración.
No se desplegó en Render. Las pruebas locales no verifican configuración viva,
MIPRES, Drive o Sheets externos, backup/restore ni reconciliación en staging.
Ninguno de estos resultados cierra AUD-P0-02/03/04 ni reemplaza certificación.

## 2. Bloqueadores P0 abiertos

| Hallazgo  | Estado                       | Motivo y evidencia resumida                                                                                                                         |
| --------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-P0-01 | **PENDIENTE CI/SHA** | El corte original reportó 4 críticas y 27 altas. El árbol local posterior pasó auditoría y gates P0.1; falta CI Node 22 para un SHA limpio. |
| AUD-P0-02 | **ABIERTO — FALTA STAGING** | Blueprint y matriz local preparados; faltan Dashboard/configuración viva, permisos y pruebas sintéticas por servicio. Sentry/OTel siguen pendientes de decisión operativa. |
| AUD-P0-03 | **ABIERTO — FALTA APROBACIÓN** | Registro de RF-01 a RF-04 preparado; faltan decisiones firmadas y luego implementación/UAT, o exclusiones explícitas del release. |
| AUD-P0-04 | **ABIERTO — FALTA CERTIFICACIÓN** | Runbook preparado y suite sintética local aprobada; faltan despliegue persistente, migraciones en staging, backup/restore e integraciones externas/reconciliación en staging. |

El bloqueo inmediato registrado por W0-01 fue AUD-P0-01 en el corte histórico.
Su remediación local no autoriza producción mientras falten CI sobre SHA limpio,
los demás bloqueadores y los gates obligatorios.

## 3. Gates obligatorios

Los estados incorporan la evidencia histórica del corte y las actualizaciones
locales fechadas. `PASS LOCAL` no equivale a certificación de despliegue o
producción.

| Gate                                                      | Estado                    | Evidencia o pendiente                                                                                      |
| --------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Instalación con `pnpm install --frozen-lockfile`          | PASS LOCAL                | Instalación limpia en el build de integración con Node 22; lockfile vigente.                                |
| `pnpm audit --prod`                                       | PASS LOCAL POSTERIOR      | Sin vulnerabilidades conocidas; el corte histórico reportó 4 críticas y 27 altas.                           |
| `pnpm lint`                                               | PASS LOCAL                | Ejecutado sin warnings ESLint.                                                                             |
| `pnpm format:check`                                       | **FAIL**                  | 299 archivos no cumplen Prettier.                                                                          |
| Typecheck sin caché                                       | PASS LOCAL                | `pnpm exec turbo typecheck --force`: 13 tareas exitosas, cero caché.                                        |
| Pruebas unitarias                                         | PASS LOCAL                | 739 pruebas Vitest, escáner legacy y 8 pruebas Node de seguridad de integración.                            |
| Pruebas de integración                                    | PASS LOCAL AISLADO        | 46 archivos y 526 pruebas con PostgreSQL 17, Redis y migraciones reales en entorno temporal.               |
| Cobertura y umbrales                                      | NO VERIFICADO             | No existe configuración de cobertura cuantitativa ni umbrales.                                             |
| Build de API, Web y Worker                                | PASS LOCAL                | Los tres artefactos compilaron; Web requirió ejecución fuera del sandbox.                                  |
| Build y validación de imágenes                            | NO VERIFICADO             | No consta construcción, SBOM ni escaneo de las imágenes en la evidencia del corte.                         |
| Catálogo de base de datos                                 | PASS LOCAL                | Prueba del generador y comprobación de 14 archivos sin drift.                                              |
| Journal y migraciones sin drift                           | PENDIENTE                 | Existe un `0079` huérfano y no se consultaron los historiales de las bases persistentes.                   |
| Esquema JSON de `render.yaml`                             | PASS LOCAL                | El 2026-11-03 el esquema público actual validó el YAML local con cero errores.                              |
| Validación semántica de Render                            | NO VERIFICADO             | Render CLI respondió 401 Unauthorized; falta validar contra el workspace autorizado.                        |
| Configuración viva igual a la matriz esperada             | NO VERIFICADO             | No se inspeccionaron variables, secretos ni migraciones de servicios persistentes.                         |
| Backup, restauración y reconciliación                     | NO VERIFICADO             | Falta política certificada y restore drill con validaciones y tiempos.                                     |
| MIPRES, Sheets y Drive: éxito y degradación               | NO VERIFICADO             | No se ejecutaron pruebas reales; deben usarse integraciones y datos sintéticos controlados.                |
| RF P0 decididos e implementados o excluidos               | PENDIENTE                 | RF-01 a RF-04 no tienen decisión formal completa.                                                          |
| UAT y seguridad aprobados por SHA                         | NO VERIFICADO             | No hay certificación UAT completa, DAST ni aprobación de seguridad del entorno persistente.                |
| Ausencia de datos clínicos reales en pruebas y artefactos | PASS EN EL CORTE AUDITADO | La auditoría no accedió a datos clínicos reales; toda evidencia posterior debe conservar esta restricción. |

## 4. Condiciones de desbloqueo

### Bloqueo específico por dependencias

Para cerrar AUD-P0-01 se requiere, sobre un SHA candidato identificado:

1. instalación reproducible con lockfile congelado;
2. remediación de las dependencias y regresión completa de los flujos afectados;
3. `pnpm audit --prod` sin vulnerabilidades críticas ni altas, o una excepción
   formal vigente con fecha de vencimiento, responsable y controles
   compensatorios;
4. evidencia reproducible asociada al SHA y aprobación del responsable.

### Autorización de producción

La liberación productiva solo podrá aprobarse cuando:

- todos los gates obligatorios tengan evidencia satisfactoria y vigente para el
  SHA candidato;
- no queden hallazgos P0/P1 sin decisión;
- las exclusiones funcionales y excepciones de seguridad estén documentadas y
  aprobadas;
- se hayan verificado entorno persistente, integraciones externas, recuperación,
  UAT y despliegue controlado;
- el Administrador del sistema registre su aprobación final.

Cualquier cambio posterior en el SHA candidato exige reevaluar los gates
afectados. Un PASS local histórico no sustituye esa verificación.

## 5. Historial de estado

| Fecha      | SHA                                        | Estado                                | Responsable               | Evidencia                                                                                  |
| ---------- | ------------------------------------------ | ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-10-30 | `61aaa65c09215eb71432315456dc5c73082fc9e0` | BLOQUEADO — NO LIBERABLE A PRODUCCIÓN | Administrador del sistema | [Auditoría total](../.agent/plans/AUDITORIA-TOTAL-2026-10-30.md), especialmente AUD-P0-01. |
