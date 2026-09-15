# ADR-038 — ESP-015 Alcance organizacional y autorización por punto de dispensación

Estado: implemented / pending review  
Fecha: 2026-09-15

## Contexto

Hasta ESP-014 el control de acceso es RBAC funcional (qué acción). Un `MEDICARTE_OPERATOR` con `patient_schedules.manage` podía operar cualquier `dispensing_point` visible. ESP-015 añade una segunda dimensión: **data scope** (sobre qué puntos).

El frontend no es frontera de seguridad. PostgreSQL sigue siendo source of truth. No se duplican organizaciones: se reutilizan `organizations`, `users`, `user_organization_roles` y `dispensing_points`.

## Decisión

1. **RBAC ≠ data scope.** La autorización efectiva es `RBAC_PERMISSION AND RESOURCE_WITHIN_DATA_SCOPE`. No se crean roles por punto (`MEDICARTE_BOGOTA_NORTE_OPERATOR`).
2. **Modelo.** Tabla nueva `user_point_scopes` (grants). Unicidad parcial activa `(user_id, dispensing_point_id) WHERE revoked_at IS NULL`. Grants históricos revocados se conservan. No hay tabla `organizations` duplicada.
3. **MTD = global.** `MTD_ADMIN`, `MTD_OPERATOR`, `MTD_GENERAL`, `MTD_AUDITORIA` y `READ_ONLY` en org MTD no requieren grants por punto. RBAC sigue limitando la acción. No hay backfill por punto.
4. **Medicarte = explicit fail-closed.** `MEDICARTE_OPERATOR` sin grants activos = cero puntos. Nunca "vacío = todos".
5. **OLP / Compensar.** Point grants no cruzan fronteras de actor. OLP permanece en su límite logístico. Compensar no gana operación interna.
6. **Resolver único.** `OperationalAccessScopeService` + helpers `applyPointScope` / `lockActivePointGrants`. Los controllers no ramifican `if role === MEDICARTE_OPERATOR`.
7. **Listas en SQL.** `WHERE dispensing_point_id IN (SELECT … FROM user_point_scopes WHERE revoked_at IS NULL)`. MTD global no usa `IN` artificial de todos los puntos.
8. **IDOR.** GET/PATCH/POST por id: si el recurso existe y el punto está fuera de scope → `403 POINT_ACCESS_DENIED` antes de detalles de dominio. Listas no lo enumeran.
9. **Transfers.** Crear, despachar y recibir exige **source AND destination** en el scope del actor.
10. **Lineage.** El punto se deriva del recurso (schedule, delivery_lines, lot). No se añade `user_id` a entidades históricas. No se reescribe historia al revocar.
11. **Bulk.** Preview marca `POINT_ACCESS_DENIED` por fila. Confirm revalida en la transacción de la fila (`createInTx` + `FOR SHARE`). Preview no reserva autorización. Jobs: visibilidad owner para Medicarte + MTD global. Filas VALID/SUCCEEDED de puntos fuera del scope actual se ocultan. Las filas con `POINT_ACCESS_DENIED` permanecen visibles al owner: son el resultado de autorización de su propio archivo, no un leak operacional de otro punto.
12. **Revalidación transaccional.** Mutaciones críticas toman `SELECT … FOR SHARE` sobre el grant activo antes de COMMIT. Una revocación visible antes de esa frontera deniega. Redis no es autoridad de scope. Sin caché de autorización.
13. **Admin.** `operational_scopes.read` / `operational_scopes.manage`. `MTD_ADMIN` manage. `MTD_AUDITORIA` read. Medicarte no se autoasigna. `PUT /access-scopes/users/:userId/points` reemplaza el conjunto completo en una transacción. Audit: `OPERATIONAL_POINT_SCOPE_GRANTED|REVOKED|REPLACED`.
14. **Backfill.** Ninguno. No se inventan grants. Cutover fail-closed para Medicarte.
15. **Punto inactivo.** No es asignable como grant nuevo. Un grant histórico puede quedar para auditoría. "Scope autorizado" ≠ "punto operacionalmente activo".
16. **Analytics / auditorías.** Medicarte no gana analytics ni application audits. Drill-down MTD con `dispensingPointId` revalida la política del actor. Export obedece los mismos permisos.
17. **Sin RESERVED.** ESP-015 no introduce reserva de inventario.

## Revalidación / lock

`lockActivePointGrants(tx, actor, pointIds)` ejecuta, para actores `explicit`:

```sql
SELECT id FROM user_point_scopes
 WHERE user_id = $1 AND dispensing_point_id = $2 AND revoked_at IS NULL
 FOR SHARE
```

Si no hay fila → `PointAccessDeniedError` (`POINT_ACCESS_DENIED`). El `FOR SHARE` bloquea un `UPDATE revoked_at` concurrente hasta COMMIT de la mutación; si la revocación ya committed, el SELECT no ve fila.

Se invoca en: schedule create/reschedule/cancel, receipt create/update/confirm, transfer create/dispatch/receive/cancel, application create/update/confirm/cancel, outcome NOT_APPLIED, bulk `createInTx`.

## Consecuencias

- Migración `0047_esp015_point_scopes.sql`.
- Gate A: PostgreSQL limpio hasta 0047 (48 migraciones, 0000–0047).
- Gate B: DB exacta ESP-014 + únicamente 0047.
- Medicarte sin grants no opera puntos. MTD conserva alcance global sujeto a RBAC.
