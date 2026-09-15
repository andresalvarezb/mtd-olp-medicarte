# ADR-037 — ESP-014 Operaciones masivas, importación y exportación XLSX

Estado: accepted  
Fecha: 2026-09-14

## Contexto

ESP-003 ya permite cargar programaciones XLSX con staging y confirmación síncrona. ESP-013 entrega un read model analítico. ESP-014 convierte ese canal en un job explícito versionado y añade exportación analítica, sin crear un segundo dominio.

PostgreSQL sigue siendo la fuente de verdad. El XLSX es transporte.

La confirmación funcional de ESP-014 usaba un mutex in-memory por proceso. Ese mutex serializaba double-click en un solo nodo; no coordinaba dos instancias API contra la misma base. El hardening de concurrencia elimina esa dependencia semántica.

## Decisión

1. **XLSX is transport, not domain.** Toda fila de programación se valida con las mismas reglas ESP-003. La API individual usa `PatientScheduleService.create()`. El bulk usa `createInTx(tx)` sobre la misma lógica. No hay SQL de negocio en el parser.
2. **Staging** vive en `bulk_import_jobs` / `bulk_import_rows` / `bulk_import_row_attempts`. No se persiste el binario XLSX: solo hash, metadatos y payload normalizado.
3. **Preview** es informativo. No reserva identidad de programación, inventario, período, autorización ni demanda.
4. **Confirmación explícita.** Upload valida y deja el job en `READY` o `INVALID`. La mutación ocurre solo con `POST /confirm` sobre `READY` (o resume de `PROCESSING`).
5. **Ejecución por fila, atómica.** Una transacción PostgreSQL por fila. Claim fenced (`FOR UPDATE`) + `PatientScheduleService.createInTx(tx)` + mark `SUCCEEDED` + history/audit ESP-003 + attempt. El insert de schedule usa SAVEPOINT para que un `23505` de identidad no aborte la sesión. No se deja abierta una transacción durante todo el XLSX.
6. **Partial success.** 95 ok + 5 fallos = `PARTIALLY_COMPLETED`. No hay rollback de las filas exitosas. Todas fallan = `FAILED`.
7. **Idempotencia.** `idempotency_key = jobId:rowNumber`. `SUCCEEDED` no se reejecuta.
8. **PostgreSQL coordina confirmación.** El mutex in-memory se eliminó. No es primitive de corrección. Dos nodos API pueden confirmar el mismo job; la exclusión es el claim atómico de fila.
9. **Row claim.** Un único `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`. Transiciones reclamables: `PENDING` (confirm), `FAILED` (retry-failed), o `PROCESSING` con lease expirado o `claim_expires_at IS NULL`. Nunca `SUCCEEDED` ni `SKIPPED`. Dos procesos no pueden obtener `RETURNING` de la misma fila.
10. **Fencing.** Cada claim asigna `claim_token` (UUID) y `claim_generation = claim_generation + 1`, con `claimed_at` y `claim_expires_at` (120 s). La transacción de ejecución vuelve a tomar la fila `FOR UPDATE` y exige token+generation **antes** de `createInTx`. Un claimant stale no llega a crear schedule ni a marcar `SUCCEEDED`.
11. **Lease y row lock.** `claimNextRow` usa `SKIP LOCKED`. Mientras la transacción de ejecución sostiene `FOR UPDATE`, otro proceso no puede reclamar esa fila aunque el lease haya expirado. Al `COMMIT`, la fila es `SUCCEEDED` y deja de ser reclamable. Al `ROLLBACK`/crash, la fila permanece `PROCESSING` y se recupera cuando el lease expire.
12. **Crash semantics.** Crash antes de `COMMIT`: no schedule, row recuperable. Crash después de `COMMIT`: schedule + row `SUCCEEDED` + history. No existe la ventana schedule persistido / row no succeeded.
13. **Duplicate real.** `PATIENT_SCHEDULE_DUPLICATE` es error de dominio. No se trata como éxito salvo que la misma transacción de esta fila haya creado el schedule (en cuyo caso el mark `SUCCEEDED` ya es atómico). Un duplicate de otro job/usuario permanece `FAILED`.
14. **Job claim.** `UPDATE` corto `READY | PARTIALLY_COMPLETED | FAILED | PROCESSING → PROCESSING` con `FOR UPDATE` y heartbeat. Varios procesadores pueden work-steal filas. El lock del job no se sostiene durante la transacción de la fila.
15. **Finalización.** El estado terminal se deriva de conteos persistidos en PostgreSQL: todas `SUCCEEDED` → `COMPLETED`; mezcla → `PARTIALLY_COMPLETED`; todas fallan → `FAILED`. Si queda `PENDING` o `PROCESSING`, el job permanece `PROCESSING`. El primer `UPDATE … WHERE status = 'PROCESSING'` gana la transición terminal.
16. **Worker.** No hay cola BullMQ. Tope 5000 filas; procesamiento síncrono en el request. Redis no es fuente de verdad.
17. **Alcance de importación inicial = SCHEDULING.** No hay bulk de applications, inventory, audits, OC, receipts ni outcomes.
18. **Export analítico.** `GET /analytics/export.xlsx` llama al mismo `AnalyticsService.operational`. No recalcula KPIs. Economía solo si el actor tiene `analytics.economics.read`. `UNAVAILABLE` se escribe "No disponible", nunca `0`.
19. **PHI.** Audit y logs usan job id, row number y error code. El staging puede contener documento bajo RBAC.
20. **Límites MVP.** 20 MiB, 5000 filas, 20 columnas, 5 hojas. Rechazo de macros, fórmulas y links externos expuestos por SheetJS.
21. **Retry.** `retry-failed` toca `FAILED` con `executed_at` anterior a `processing_heartbeat_at` de la oleada, o `PROCESSING` con lease expirado, desde `PARTIALLY_COMPLETED` o `FAILED`. Una fila que vuelve a `FAILED` en la misma oleada no se reclama otra vez. Cancel se permite en `UPLOADED`/`VALIDATING`/`READY`/`INVALID`, no en `PROCESSING`.
22. **Plantilla.** `ESP014_SCHEDULING_V1` en hoja `METADATA`. Una versión desconocida se rechaza; no se reinterpretan columnas nuevas sobre una plantilla vieja.
23. **Retención.** El staging se conserva para auditoría operacional. El archivo original no.
24. **Migración de hardening.** `0046_esp014_claim_fencing.sql` (no se reescribe `0045`). Columnas de claim/lease. La atomicidad schedule+row no requiere migración nueva: comparte la transacción de `createInTx`.
25. **API individual.** `POST /patient-schedules` sigue usando `PatientScheduleService.create()`, que envuelve el mismo `createInTx` en su propia transacción. Scheduling no depende de bulk.

## Concurrencia multi-instancia

```text
API A y API B → misma PostgreSQL → POST /confirm del mismo job READY

1. Ambos pueden pasar el job a PROCESSING (CAS corto).
2. Cada fila ejecutable se adquiere con SKIP LOCKED + token/generation.
3. Transacción por fila: FOR UPDATE del claim → createInTx (schedule+history+audit) → mark SUCCEEDED.
4. finalizeFromRows recalcula desde bulk_import_rows.
```

Dos jobs con la misma identidad de programación: ESP-003 rechaza el duplicado activo (`PATIENT_SCHEDULE_DUPLICATE`). Staging no es autoridad de unicidad. Ese duplicate **no** se convierte en éxito.

## Riesgo residual

Fallos de dominio (`PATIENT_SCHEDULE_DUPLICATE`, autorización no programable, etc.) no abortan la sesión PostgreSQL: el insert de schedule corre bajo SAVEPOINT. El duplicate se traduce a outcome de dominio, la transacción de ejecución hace rollback y `FAILED` se registra en una transacción fenced posterior. Un error inesperado (p. ej. crash del proceso o fallo inyectado al marcar `SUCCEEDED`) deja la fila `PROCESSING` recuperable por lease; no deja un schedule huérfano. `PATIENT_SCHEDULE_DUPLICATE` genérico no se trata como éxito.

## Consecuencias

- Gate A: PostgreSQL limpio hasta ESP-014 (migraciones 0045 y 0046).
- Gate B: upgrade exacto ESP-013 → ESP-014 (aplica `0045_esp014_bulk_imports.sql` y `0046_esp014_claim_fencing.sql`).
- El endpoint ESP-003 `/patient-schedules/imports` permanece; ESP-014 es el canal versionado y el módulo UI Importaciones.
- Corrección no depende de memoria local. Dos nodos API pueden procesar el mismo job sin duplicar efectos.
