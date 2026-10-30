# Auditoría de documentación y vigencia

**Repositorio:** `andresalvarezb/mtd-olp-medicarte`
**Rama inspeccionada:** `develop`
**SHA base:** `7ced5792c08faf35e673e2f1c2ca4571892ab87a`
**Fecha:** 2026-10-17

Esta auditoría conserva el corte histórico indicado arriba. Las actualizaciones
de checkout del 2026-10-29 y 2026-10-30 aparecen al final del documento.

## Evidencia consultada

- `README.md`, `RESULTADOS_DEVELOP.md`, `.env*.example`, manifests pnpm.
- `apps/api/src/app.module.ts`, controladores de los principales dominios,
  `apps/api/src/main.ts`, guards y estados de autorización.
- `apps/web/app/*/page.tsx`, `apps/worker/src/worker.service.ts`.
- `docker-compose.yml`, `docker-compose.local.yml`, `scripts/local.sh`,
  `scripts/dev-local.sh`, `.github/workflows/ci.yml`.
- `packages/database/migrations/meta/_journal.json` y migración 0101.
- ADR y requerimientos de `docs/`; documentación de `.agent` como
  antecedentes, no como prueba por sí sola de implementación.
- Historial reciente de `develop` hasta los PR #87, #86 y #85 (16-10-2026).

## Hallazgos y correcciones documentales propuestas

| Prioridad | Hallazgo | Tratamiento en este paquete |
| --- | --- | --- |
| Alta | El README describe una base con módulos operativos retirados, mientras `AppModule` registra numerosos controladores operativos. | Sustituir por inventario actual del código, sin certificar despliegue. |
| Alta | El arranque genérico del README no distingue `docker-compose.local.yml` de la integración. | Documentar `bash scripts/local.sh up`, entorno `.env.local` y puertos correctos. |
| Alta | El flujo lineal del README puede confundirse con una única fuente de OC y con stock por compra. | Distinguir demanda, OC, recepción real, reservas y consumo. |
| Alta | ADR-043 mezcla AS-IS de septiembre, decisiones TO-BE y notas posteriores de implementación. | Añadir advertencia de vigencia y referencia explícita al código de `develop`. No reescribir el ADR histórico. |
| Media | `RESULTADOS_DEVELOP.md` registra un Macro Paso 1 y una rama de trabajo anterior, no el estado de `develop` de octubre. | Conservar como informe histórico; dejar de presentarlo como resumen actual. |
| Media | El CI permite `pull_request` y push a `master`/`main`, pero no push directo a `develop`. | Declararlo en la guía de verificación; no etiquetar los pushes como CI validado. |
| Media | Los ADR/planes de `.agent` pueden confundirse con funcionalidad terminada. | Crear índice que separe diseño e implementación observada. |
| Media | Al corte del 2026-10-17, el journal tenía 101 entradas hasta 0101; Git no prueba qué migraciones aplicó cada base. | Conservar este dato como evidencia histórica; el corte actual tiene 103 entradas hasta 0103. |

## Documentos existentes que deben conservarse

- `docs/adr/042-reconciliation-operations-and-alerts.md`.
- `docs/adr/043-authorization-order-receipt-fulfillment-reassignment.md`.
- `docs/adr/044-realtime-operational-invalidation.md`.
- `docs/requirements/BR-AUTO-ANNUL-001-anulacion-autorizacion.md`.
- `docs/requirements/BR-AUTO-REN-001-estado-16-vigencia.md`.
- `.agent/adr/ADR-028` a `ADR-042`, `.agent/plans/ESP-020-*`,
  `.agent/specs/*` como trazabilidad de decisiones y diseños.

## Verificaciones pendientes para afirmar cierre técnico

1. Recalcular inventario de endpoints mediante OpenAPI arrancado y contrastar
   con el mapa documental.
2. Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y
   `pnpm test:integration` en checkout sincronizado con `develop`.
3. Verificar contra PostgreSQL real las migraciones aplicadas y los casos
   de concurrencia OC/asignaciones/anulación/fulfillment.
4. Confirmar alcance efectivo de las notas posteriores de ADR-043 antes de
   afirmar que toda reasignación descrita está desplegada y certificada.
5. Resolver la falta de ejecución de CI por `push develop` si el proceso de
   entrega espera esa garantía.
6. Realizar un smoke test HTTP autenticado con actores MTD/OLP/MEDICARTE,
   evitando datos clínicos reales.

**Límite de la revisión:** inspección estática de fuentes remotas. No se
compiló ni ejecutó el proyecto durante la creación de la documentación. La
actualización se ha preparado contra un SHA fijo y debe revisarse de nuevo
si `develop` avanza antes de aplicar los cambios.

## Ampliación operativa — 2026-10-17

Se agregan `manual-operativo.md`, `flujo-mtd.md`, `flujo-olp.md`,
`flujo-medicarte.md`, `casos-de-uso.md` y `matriz-pruebas-operativas.md`.
Las guías registran lo que muestran controladores/servicios/contratos y las
rutas de interfaz, con campos de plantilla AT/AUTO/OC y modelos de cantidades.

**Advertencias:** los casos de la matriz son **PENDIENTES**, no `PASS`. Es preciso
confrontar formularios, errores, recepciones `quantity-only` y excepciones en
API/PostgreSQL. En la creación por importación, una nueva OC válida es emitida;
en el flujo programático de API `create` y `issue` están separados. La pantalla
`/importaciones` redirige a `/autorizaciones`, al igual que `/logistica-olp`
redirige a `/ordenes-compra`.

## Ampliación de casos especiales — 2026-10-17

Se agrega `docs/casos-especiales/` con ocho guías, reglas y una matriz de 47 escenarios **pendientes de ejecución**, basados en lectura estática de `develop` al SHA `6b611d80d5fbe920d3464baaca9424eb6ad2f387`. No certifica resultados de integración ni despliegue. Hallazgo crítico: `inventory-expiration-release.ts` no libera asignaciones automáticamente; solo envía invalidaciones de consulta. Se documentan asimismo edición MTD y su impacto limitado en OC, auditoría de facturación individual/XLSX, soportes y sincronización Drive opcional, auditorías de aplicación/fulfillment y conciliación. Véanse [casos especiales](casos-especiales/README.md) y [pendientes](casos-especiales/cobertura-pendiente.md).

## Cobertura de excepciones adicionales — 2026-10-17

Inspección estática nueva de `develop` al commit `97ade0b87f1a6e87730c89bf718169df41254155`.
Se añaden ocho guías con **CE-33 a CE-84** (**84 casos documentados acumulados**), una cartera de diez brechas **RF-01 a RF-10**, y 50 escenarios adicionales **TE-48 a TE-97** (**97 pruebas propuestas acumuladas**).
Se verificaron controladores, repositorios, contratos y política de roles para MIPRES, resultados de no aplicación, programación, recepción por entregas/directa por OC, traslados, analíticas y RBAC.

**Límites específicos:** no se verificó flujo integral de devoluciones postrecepción, recepción parcial de traslado, ajuste genérico por merma o contabilidad financiera; por tanto NO se describen como implementados. La auditoría de facturación es distinta de cierre contable. Las pruebas siguen pendientes de ejecución; no se consultó base de datos ni ambiente desplegado. Véanse [índice de excepciones](casos-especiales/README.md), [brechas](casos-especiales/pendientes-funcionales-priorizados.md) y [matriz de pruebas](casos-especiales/matriz-pruebas-especiales.md).

## Actualización AC-FIN-001 — 2026-10-20

El PR #91 integró el control de capacidad de compra pendiente
tras anulación de autorizaciones.

Se documentan por separado disponibilidad física, compromisos
pendientes e historial liberado.

Documento:
[AC-FIN-001](requirements/AC-FIN-001-capacidad-compra-anulaciones.md).

La evidencia de integración del código no sustituye validación
PostgreSQL, concurrencia, UAT ni verificación de despliegue.

## Actualización del checkout — 2026-10-29

El checkout `feat/purchase-order-authorization-reassignment` @ `3627564`
contiene 103 entradas en `_journal.json`; la última es
`0103_mtd_moderator_fee_permission`. Las rutas de cuota moderadora y del
dashboard financiero están registradas en los controladores del API.

El PR #94 ya forma parte de `develop`. Las correcciones posteriores de lint e
integración/CI están en este checkout, pendientes de integrarse en `develop`.
`pnpm lint` pasó localmente en `3627564` el 2026-10-29; esto no certifica una
ejecución de CI ni un despliegue.

## Cierre de verificaciones locales — 2026-10-30

Checkout inspeccionado: `feat/moderator-fee-sheets-config-local` @
`3f72d81c78f5a1d43cd1f0310c3df2754c80ad30`. La lista pendiente de la auditoría
inicial queda como antecedente fechado; el estado comprobado en este checkout es:

| Verificación | Estado | Evidencia y límites | Fecha | SHA del checkout |
| --- | --- | --- | --- | --- |
| Inventario HTTP | PASS | OpenAPI del API activo en integración aislada: 187 rutas, 211 operaciones. Se contrastaron métodos y paths representativos de [api-guide.md](api-guide.md); inventario completo en [api-openapi-inventory.md](api-openapi-inventory.md). | 2026-10-30 | `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30` |
| Calidad local | PASS | `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; 359 pruebas unitarias PASS. `pnpm test` pudo usar tareas Turbo en caché; la suite se ejecutó también sin caché y pasó. El build se repitió fuera del sandbox tras un `EPERM` al iniciar TypeScript. | 2026-10-30 | `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30` |
| PostgreSQL e integración | PASS aislado; PENDIENTE persistente | `pnpm test:integration`: 45 archivos, 525 pruebas PASS en PostgreSQL 17 temporal, con migraciones aplicadas. Falta identificar y consultar la base persistente del entorno de release, con acceso autorizado, para conocer migraciones y SHA desplegado; no se consultó producción. | 2026-10-30 | `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30` |
| Notas 15/16-10 de ADR-043 | Código presente; despliegue NO verificado | La lógica de asignación y locks descrita se observa en el servicio/repositorio actual; hay cobertura unitaria relacionada y pasó la suite de integración. Se conserva «NO desplegada» como anotación histórica del 16-10. No se afirma certificación independiente de cada invariante ni despliegue actual. | 2026-10-30 | `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30` |
| CI en `develop` | PASS configuración | `.github/workflows/ci.yml` contiene `develop`, `master` y `main` para push, y conserva `pull_request`. No se consultó GitHub Actions ni se afirma una ejecución remota. | 2026-10-30 | `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30` |
| Smoke HTTP autenticado | PASS | Cuentas sintéticas: MTD `GET /planning-periods` → 200; OLP `GET /supplier/purchase-orders` → 200; MEDICARTE `GET /inventory` → 200; sin token `GET /planning-periods` → 401. Los tres cuerpos contienen `items` tipo array. No se usaron ni registraron tokens o datos clínicos. | 2026-10-30 | `3f72d81c78f5a1d43cd1f0310c3df2754c80ad30` |

### Contexto de los resultados

- El PASS de AC-FIN-001 del 2026-10-19 permanece como evidencia histórica de
  aquella rama/fecha; no se atribuye al checkout actual. Véase
  [evidencia AC-FIN-001](requirements/AC-FIN-001-auditoria-financiera-alto-costo.md).
- El smoke prueba autenticación, permisos de lectura y forma básica de respuesta
  para actores sintéticos. No ejecuta recaudo, importación, compra, recepción,
  fulfillment, concurrencia ni XLSX.
- El SHA indicado identifica el checkout base probado; los archivos de
  documentación, CI y smoke de esta actualización están en el árbol de trabajo
  y no forman parte de ese commit hasta que se registren en Git.
- No se observaron fallos de `lint`, typecheck, unitarias o integración que
  requirieran cambios correctivos de código en este corte.

### Revisión de las notas de ADR-043

- **15-10:** el importador actual mantiene separadas la asignación de stock
  recibido y la ampliación de compra para una OC existente. La lógica
  `ASSIGN_AVAILABLE` y la conservación de `requested_quantity` están en
  `apps/api/src/purchase-orders/purchase-order-import.service.ts`; hay cobertura
  relacionada en `purchase-order-import-existing.service.test.ts` y
  `purchase-order-import-rules.service.test.ts`.
- **16-10:** el código actual contempla entradas modernas `quantity-only` y
  locks por OC/producto en los flujos de disponibilidad/importación
  (`apps/api/src/inventory/inventory-availability.repository.ts` y
  `apps/api/src/purchase-orders/purchase-order-import.service.ts`). El PASS de
  la suite local no certifica cada invariante bajo concurrencia en una base
  persistente. La frase «NO desplegada» se conserva como estado registrado el
  16-10; el despliegue del código actual queda sin verificar.
