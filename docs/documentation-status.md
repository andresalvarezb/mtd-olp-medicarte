# Auditoría de documentación y vigencia

**Repositorio:** `andresalvarezb/mtd-olp-medicarte`
**Rama inspeccionada:** `develop`
**SHA base:** `7ced5792c08faf35e673e2f1c2ca4571892ab87a`
**Fecha:** 2026-10-17

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
| Media | Las migraciones se enumeran hasta 0101, pero el estado real de cada base no aparece en Git. | Registrar '101 entradas en journal', sin afirmar 'aplicadas en producción'. |

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
