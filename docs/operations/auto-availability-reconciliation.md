# BR-AUTO-DISP-001 — Reconciliación de disponibilidad preexistente

## Estado y alcance

Complemento del asignador del PR #154. La implementación debe pasar las pruebas locales
obligatorias y el CI antes de integrarse. Este documento no certifica un despliegue ni una
asignación en producción.

El defecto abordado es la ausencia de reevaluación general del stock recibido antes del
despliegue. No se cambia la habilitación, la vigencia, el saldo pendiente, el orden de
prioridad, la cobertura, el criterio de aplicación confirmada ni la política de retención
de reservas. El reconciliador reutiliza `assignAutomaticallyInTx` y sus revalidaciones.
No inventa recepciones, no recupera unidades consumidas y no reescribe fuentes comerciales.

## Diseño

- Descubrimiento paginado por código comercial a partir de recepciones reales, no de
  `purchase_order_authorization_sources`. Incluye las fuentes directas y ledger.
- El cursor usa orden `COLLATE "C"` tanto para comparar como para ordenar. Cada producto
  se planifica con todas sus OCs, evitando que un límite por OC impida completar una AUTO.
- Una transacción independiente por producto; un fallo no revierte los otros productos.
  La reserva completa desde varias OCs conserva la atomicidad del asignador existente.
- Simulación protegida por una transacción PostgreSQL `READ ONLY`, con snapshot repetible.
  No crea lotes, allocations, auditorías operativas ni invalidaciones. Solo registra un
  resumen técnico en logs. El plan es informativo: la ejecución siempre recalcula.
- Bloqueo asesor transaccional por producto entre reconciliadores. Los bloqueos originales
  de recepción/asignación y las comprobaciones de saldo siguen siendo autoritativos.
- Hasta tres intentos en transacciones nuevas para SQLSTATE 40001, 40P01 y 55P03.
  No se ocultan errores con mensajes de éxito. Se devuelven `PARTIAL_FAILURE` y `BUSY`.
- Presupuesto de planificación de 20 segundos y timeouts de sentencia/bloqueo de 15/2
  segundos. No son un límite absoluto de duración de toda la transacción. Una planificación
  que exceda el presupuesto se revierte y se informa; no se trunca la prioridad.
- El scheduler usa un único temporizador, sin ejecuciones superpuestas dentro de una
  instancia. Procesa una página, cede un segundo entre páginas y espera el intervalo
  configurado al terminar el barrido. No bloquea el health check.
- El cursor es en memoria. Tras reiniciar se recorre de nuevo; no se pierde inventario
  porque cada intento recalcula el saldo. Un producto ocupado o fallido se revisita en el
  siguiente barrido completo. Los logs incluyen contadores y correlationId, no pacientes.

## Acceso

El endpoint y el scheduler requieren un usuario activo con `inventory.allocate`,
organización MTD activa y rol administrativo real `MTD_ADMIN`. `AccessService` vuelve a
consultar la base en cada producto y en cada reintento. No se crean usuarios ni permisos.
No se elige un administrador automáticamente ni se inventa un scope con privilegios.
El punto se deriva de las políticas existentes y se revalida al asignar.

El scheduler usa un actor explícito aprobado por operación, mediante los IDs de un
usuario y una organización existentes. La auditoría del asignador conserva ese usuario y
registra `source=AUTO`, `trigger=AVAILABILITY_RECONCILIATION` y el correlationId.

## Endpoint

`POST /api/v1/inventory/availability/auto-reconcile`

Autenticación habitual y cabecera `x-organization-id`. Un cuerpo vacío simula una página:

```json
{"dryRun":true,"limit":1,"commercialCodes":["10156"]}
```

Opcionalmente se puede restringir `dispensingPointIds` con UUIDs reales y autorizados.
La respuesta contiene `hasMore`, `nextCursor`, cantidades planeadas/asignadas, fallos,
productos ocupados y el resultado por producto. Para continuar, reenviar los mismos
filtros y el `nextCursor` como `cursor`. No reutilizar cursores entre filtros diferentes.

La ejecución exige confirmación explícita:

```json
{"dryRun":false,"confirm":"ASSIGN_AVAILABLE_STOCK","limit":1,"commercialCodes":["10156"]}
```

Esto sí modifica reservas. No ejecutarlo como una prueba inocua. Hacer primero una
simulación y revisar las AUTOs, OCs, cantidades, vigencias y puntos; ejecutar con autorización
operativa. Ante `BUSY` o `PARTIAL_FAILURE`, conservar el informe y reevaluar los productos
señalados. Nunca informar todas las páginas como completadas si alguna falló.

## Scheduler en authorization-api

No se requieren variables nuevas en `authorization-worker`. Valores iniciales:

| Variable | Valor inicial / requisito |
| --- | --- |
| INVENTORY_AUTO_RECONCILE_ENABLED | false por defecto |
| INVENTORY_AUTO_RECONCILE_DRY_RUN | true por defecto |
| INVENTORY_AUTO_RECONCILE_ACTOR_USER_ID | UUID explícito, existente y aprobado |
| INVENTORY_AUTO_RECONCILE_ORGANIZATION_ID | UUID existente de MTD |
| INVENTORY_AUTO_RECONCILE_BATCH_SIZE | 1 por defecto; máximo 5 |
| INVENTORY_AUTO_RECONCILE_INTERVAL_MS | 60000 por defecto; mínimo 10000 |

Un despliegue con las variables ausentes NO asigna inventario mediante el reconciliador.
Para validar en producción: habilitar el scheduler con `DRY_RUN=true`, verificar los logs
`AUTO_AVAILABILITY_RECONCILIATION_PAGE` y revisar un plan del endpoint. Solo tras aprobar
los resultados cambiar `DRY_RUN=false`, manteniendo el actor y sin ampliar sus permisos.
Con actor inválido, ausente o revocado, el servicio no tiene autorización para asignar.

Desactivar `INVENTORY_AUTO_RECONCILE_ENABLED=false` detiene futuros barridos del scheduler.
No revierte allocations confirmadas y no desactiva los disparadores del PR #154. Una
reversión de reservas necesita una operación distinta, explícita y auditada.

## Pruebas obligatorias

1. Unitarias del planificador y de `inventory-availability-reconciliation.test.ts`.
2. Integración en la BD efímera `authorization_test_integration` mediante el runner protegido.
   El escenario usa datos sintéticos, simula sin escrituras, asigna stock ya existente sin
   nuevo evento, combina OCs, ejecuta llamadas concurrentes y valida replay y auditoría.
3. Regresión `po-operational-cycle.prodshadow.test.ts` con el mismo runner aislado.
4. Build, typecheck y lint; CI del PR después de publicar.

No ejecutar el archivo de integración con un `DATABASE_URL` de producción ni directamente
con Vitest. Usar siempre `pnpm test:integration:focused` y el aislamiento del repositorio.

## Verificación posterior al despliegue

No basta con ver el servicio Live. Deben existir lotes `AUTO` confirmados y sus allocations,
y deben conservarse los saldos de recepciones, consumos y reservas anteriores.

```sql
SELECT source, status, COUNT(*) AS lotes, SUM(allocated_quantity) AS unidades
FROM inventory_allocation_batches
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY source, status;

SELECT occurred_at, action, after, correlation_id
FROM audit_events
WHERE occurred_at >= NOW() - INTERVAL '1 hour'
  AND action IN ('INVENTORY_AVAILABILITY_ASSIGNED', 'INVENTORY_AVAILABILITY_AUTO_SKIPPED')
  AND after ->> 'trigger' = 'AVAILABILITY_RECONCILIATION'
ORDER BY occurred_at DESC;
```

Registrar evidencia del commit Live, plan revisado, ejecución autorizada, lotes AUTO,
allocations, auditoría y saldos. El informe debe distinguir entre error, falta de stock,
insuficiencia para una AUTO completa, falta de punto compatible y ausencia de candidatas.

## Referencias técnicas

- Implementación base: commit d510166ef3ecbf3c58a75d1057fa1294a09e261a, PR #154.
- Drizzle: https://orm.drizzle.team/docs/transactions
- PostgreSQL 17: https://www.postgresql.org/docs/17/sql-set-transaction.html
- PostgreSQL 17: https://www.postgresql.org/docs/17/explicit-locking.html
