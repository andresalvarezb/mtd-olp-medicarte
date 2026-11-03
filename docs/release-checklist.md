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

## 2. Bloqueadores P0 abiertos

| Hallazgo  | Estado                       | Motivo y evidencia resumida                                                                                                                         |
| --------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-P0-01 | **PENDIENTE CI/SHA** | El corte original reportó 4 críticas y 27 altas. El árbol local posterior pasó auditoría y gates P0.1; falta CI Node 22 para un SHA limpio. |
| AUD-P0-02 | **ABIERTO — BLOQUEA CIERRE** | El Blueprint no expresa completamente MIPRES, Google Sheets/Drive, telemetría y reconciliación. El estado de los servicios vivos no fue verificado. |
| AUD-P0-03 | **ABIERTO — BLOQUEA CIERRE** | RF-01 a RF-04 requieren decisiones funcionales antes de implementar o excluir explícitamente esos alcances del release.                             |
| AUD-P0-04 | **ABIERTO — BLOQUEA CIERRE** | No se certificaron despliegue, migraciones, configuración, datos, jobs, backups, alertas ni recuperación en un entorno persistente.                 |

El bloqueo inmediato registrado por W0-01 fue AUD-P0-01 en el corte histórico.
Su remediación local no autoriza producción mientras falten CI sobre SHA limpio,
los demás bloqueadores y los gates obligatorios.

## 3. Gates obligatorios

Los estados siguientes reproducen la evidencia disponible en la fecha de corte.
`PASS LOCAL` no equivale a certificación de despliegue o producción.

| Gate                                                      | Estado                    | Evidencia o pendiente                                                                                      |
| --------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Instalación con `pnpm install --frozen-lockfile`          | NO VERIFICADO             | No consta en la evidencia del corte; debe ejecutarse sobre el SHA candidato.                               |
| `pnpm audit --prod`                                       | **FAIL**                  | 4 críticas y 27 altas, además de moderadas y bajas. Se exige remediación o excepción formal vigente.       |
| `pnpm lint`                                               | PASS LOCAL                | Ejecutado sin warnings ESLint.                                                                             |
| `pnpm format:check`                                       | **FAIL**                  | 299 archivos no cumplen Prettier.                                                                          |
| Typecheck sin caché                                       | NO VERIFICADO             | El typecheck local pasó, pero Turbo sirvió el resultado desde caché; el gate exige ejecución sin caché.    |
| Pruebas unitarias sin caché                               | PASS LOCAL                | 724 pruebas; una suite HTTP de 10 casos pasó fuera del sandbox por `listen EPERM`.                         |
| Pruebas de integración                                    | PASS LOCAL AISLADO        | 46 archivos y 526 pruebas con PostgreSQL 17, Redis y migraciones reales en entorno temporal.               |
| Cobertura y umbrales                                      | NO VERIFICADO             | No existe configuración de cobertura cuantitativa ni umbrales.                                             |
| Build de API, Web y Worker                                | PASS LOCAL                | Los tres artefactos compilaron; Web requirió ejecución fuera del sandbox.                                  |
| Build y validación de imágenes                            | NO VERIFICADO             | No consta construcción, SBOM ni escaneo de las imágenes en la evidencia del corte.                         |
| Catálogo de base de datos                                 | PASS LOCAL                | Prueba del generador y comprobación de 14 archivos sin drift.                                              |
| Journal y migraciones sin drift                           | PENDIENTE                 | Existe un `0079` huérfano y no se consultaron los historiales de las bases persistentes.                   |
| Esquema JSON de `render.yaml`                             | PASS LOCAL                | Cero errores contra el esquema público de Render.                                                          |
| Validación semántica de Render                            | NO VERIFICADO             | `render blueprints validate` respondió 401; requiere autenticación y workspace autorizado.                 |
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
