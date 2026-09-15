# ADR-039 — ESP-016 Cutover de campos legacy y consolidación de fuentes de verdad

Estado: implemented / pending review  
Fecha: 2026-09-15

## Contexto

ESP-001 separó el dominio clínico de `authorization_items` del dominio operacional nuevo. ESP-002…ESP-015 construyeron programaciones, demanda, OC, entregas, recepciones, inventario, traslados, aplicaciones, outcomes, auditorías, analytics, bulk y point scope. Los campos logísticos de `authorization_items` seguían existiendo. ESP-016 cierra el cutover: clasifica, aísla y demuestra que ya no controlan decisiones modernas.

## Decisión

### Estrategia

No hay DROP destructivo. PostgreSQL sigue siendo la única fuente de verdad. La dirección permitida es **NEW DOMAIN → LEGACY COMPATIBILITY**. Nunca LEGACY → NEW DOMAIN, salvo el lector histórico explícito.

No hay fallback silencioso en comandos: si falta lineage moderno esperado, es inconsistencia, no se rellena con columnas legacy. Un read histórico puede devolver legacy solo si se etiqueta como `legacy_historical`.

La generación se distingue por existencia de lineage moderno (`patient_schedules`, `patient_applications`, etc.), no por una fecha inventada.

### Clasificación

| FIELD                      | OLD MEANING                        | MODERN SOURCE                                     | CLASSIFICATION        | READERS                       | WRITERS                              | COMPATIBILITY REQUIRED | DROP BLOCKERS                                          |
| -------------------------- | ---------------------------------- | ------------------------------------------------- | --------------------- | ----------------------------- | ------------------------------------ | ---------------------- | ------------------------------------------------------ |
| lugar_dispensacion         | sede libre                         | patient_schedules.dispensing_point_id             | HISTORICAL_ONLY       | legacy history adapter        | none (runtime)                       | no                     | reader + filas pre-cutover                             |
| fecha_programada           | una fecha colapsada                | patient_schedules.scheduled_date + revision       | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | muchas fechas/revisiones modernas                      |
| fecha_dispensacion         | dispensación colapsada             | deliveries / receipts (no 1:1)                    | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | semántica partida                                      |
| fecha_aplicacion           | implicaba APPLIED                  | patient_applications.application_date + CONFIRMED | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | no reconstruye lotes                                   |
| cod_autorizacion_medicarte | referencia externa                 | none                                              | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | identificador histórico                                |
| orden_compra               | texto de OC                        | purchase_orders / lines                           | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | OC consolidada                                         |
| process_status             | pipeline monolítico                | estados partidos del dominio nuevo                | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | no hay reemplazo 1:1                                   |
| operation_status           | status operacional colapsado       | applications / outcomes / logistics               | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | CHECKs DISPENSED                                       |
| operational_version        | versionado de campos operacionales | version/revision de entidades nuevas              | HISTORICAL_ONLY       | legacy history adapter        | none                                 | no                     | operational_field_changes                              |
| audit_status               | autoridad de auditoría             | patient_application_audits                        | DERIVED_COMPATIBILITY | projection drift query        | LegacyCompatibilityProjectionService | yes                    | CHECK READY↔APPROVED                                  |
| admission_status           | hand-off downstream                | mismo campo; READY lo produce ESP-012             | AUTHORITATIVE         | audit read model, UI admisión | proyección junto a APPROVED          | yes                    | contrato ESP-012; estados posteriores fuera de alcance |

Ningún campo es `SAFE_TO_DROP_LATER`: no hay evidencia de que consumidores desconocidos, backups y CHECKs lo permitan.

### Fuentes de verdad finales

| Concern                     | Source                                                       |
| --------------------------- | ------------------------------------------------------------ |
| Scheduling                  | patient_schedules                                            |
| Demand                      | projected_demand_lines + demand_sources                      |
| Purchase                    | purchase_orders + purchase_order_lines                       |
| Delivery                    | deliveries + delivery_lines                                  |
| Receipt                     | receipts + receipt_lines                                     |
| Inventory                   | inventory_movements                                          |
| Transfer                    | stock_transfers + movement lineage                           |
| Application                 | patient_applications                                         |
| Operational outcome         | patient_schedule_outcomes                                    |
| Audit                       | patient_application_audits                                   |
| Admission                   | authorization_items.admission_status solo READY bajo ESP-012 |
| Analytics                   | derived read models                                          |
| Bulk                        | `bulk_import_*` + domain services                            |
| Point access                | user_point_scopes                                            |
| Legacy authorization fields | historical/compatibility según la matriz                     |

### Proyección de compatibilidad

`LegacyCompatibilityProjectionService` es el único escritor runtime de `authorization_items.audit_status`. APPROVED actualiza también `admission_status = READY` en la misma transacción porque el CHECK y el trigger ESP-012 lo exigen. Si la proyección crítica falla, rollback conjunto. No hay eventual consistency nueva.

REJECTED no toca admission y no usa `audit_status` legacy como autoridad.

### Lector histórico

`LegacyAuthorizationHistoryRepository` es el adapter read-only. No crea `patient_applications`, auditorías, OC ni schedules. El contrato `legacyAuthorizationHistoryResponseSchema` está marcado como compatibility, no como API operacional nueva. No se añadió un endpoint HTTP nuevo para no ampliar clientes.

### API compatibility

No hay endpoints modernos que expongan `process_status` / `operation_status` / fechas legacy. `clinicalAuthorizationResponseSchema` ya era clínico. KEEP_COMPATIBILITY: reader interno. DEPRECATE/REMOVE_LATER: drop físico en spec futura.

### Scan

`scripts/check-legacy-operational-usage.mjs` recorre el runtime moderno: `apps/api/src`, `apps/worker/src`, `apps/web`, `packages/domain/src`, `packages/database/src`, `packages/contracts/src`, `packages/config/src` y `packages/ui/src`. No escanea `node_modules`, `dist`, `.next` ni artefactos.

La clasificación ESP-016 es la fuente de los campos prohibidos. `auditStatus` camelCase **no** es un token global: se distingue por identidad del miembro. Dot y computed estático son equivalentes: `authorizationItems.auditStatus` y `authorizationItems['auditStatus']` / `authorizationItems["auditStatus"]` son leftover de `authorization_items`. `query.auditStatus`, `query['auditStatus']`, `modernAudit['auditStatus']` y `patientApplicationAudits.status` son el estado moderno. Las keys dinámicas no resolubles (`const field = 'auditStatus'; authorizationItems[field]`) quedan fuera del alcance del scanner.

`schema.ts` **no** está allowlisted por archivo, ni para campos leftover ni para `admissionStatus`. Solo se recortan declaraciones Drizzle (columnas, `table.campo` en indexes/CHECKs, incluido READY↔APPROVED). Un helper operacional en el mismo archivo — p.ej. `row.admissionStatus === 'READY'` — falla el scan.

El contrato histórico se recorta únicamente por el marker `Historical compatibility contract`. `*.test.ts`/`*.test.tsx` son evidencia; los helpers runtime sí se escanean. El script ejecuta la matriz negativa/positiva (14 FAIL / 10 PASS, incl. computed members y admission en schema) antes de escanear el repo. `pnpm test` ejecuta el scan.

### Tratamientos especiales

- **admission_status:** AUTHORITATIVE downstream. Lo escribe el flujo APPROVED. Lo lee el read model de auditoría y la UI de admisión. Transición permitida a READY únicamente vía ESP-012. Estados posteriores (ADMITTED/BILLED/…) siguen fuera de alcance. Scheduling/analytics operacional no pueden leerlo: el scan falla. En `schema.ts` solo pasan declaraciones/CHECKs; un helper runtime falla.
- **audit_status:** no es autoridad. El leftover `authorization_items.audit_status` (incl. `authorizationItems.auditStatus`) está prohibido en runtime moderno. El `auditStatus` de analytics / `patient_application_audits` sigue permitido. READY no se produce desde el campo leftover.
- **process_status / operation_status:** historical-only; no se recrea un process_status monolítico.
- **operational_version:** no controla revision/version modernas.
- **cod_autorizacion_medicarte:** identificador externo histórico, no deprecated por vivir en authorization_items.

## Consecuencias

- Migración `0048_esp016_legacy_cutover.sql` (solo COMMENT).
- Gate A: 49 migraciones (0000–0048).
- Gate B: ESP-015 + únicamente 0048.
- Mutar columnas legacy no crea ni altera hechos modernos.
- Un workflow moderno funciona con esas columnas en NULL (salvo defaults NOT NULL de audit/admission).
