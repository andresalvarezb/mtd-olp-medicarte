-- TASK-NOV-001: identidad lógica de novedades (fase 1).
-- Agrega logical_key con backfill determinístico e índices NO únicos.
-- La restricción UNIQUE parcial sobre logical_key WHERE active = true llega en
-- 0032 y solo debe aplicarse después de ejecutar scripts/reconcile-novelties.mjs
-- con --apply hasta llegar a cero duplicados activos.
ALTER TABLE "novelties"
  ADD COLUMN IF NOT EXISTS "logical_key" varchar(500);

-- ITEM|item|code|stage|field            -> causal por ítem (bulk, auditoría, autorizaciones confirmadas)
-- TARIFF|org|producto|code|stage|field  -> causal técnica del Anexo por producto (identidad de negocio)
-- TECH|IMP|batch|row / TECH|BULK|batch|row / TECH|TARIFF|batch|row
--                                        -> identidad técnica por fila de lote (sin identidad de negocio)
UPDATE "novelties" n
SET "logical_key" = CASE
  WHEN n."authorization_item_id" IS NOT NULL THEN
    'ITEM|' || n."authorization_item_id" || '|' || n."code" || '|' || n."stage" || '|' || coalesce(n."field", '-')
  WHEN n."tariff_annex_import_id" IS NOT NULL
       AND btrim(coalesce(n."original_row"->>'CODIGO_MEDICAMENTO', n."received_value", '')) <> '' THEN
    'TARIFF|' || ti."organization_id" || '|' ||
      upper(regexp_replace(btrim(coalesce(n."original_row"->>'CODIGO_MEDICAMENTO', n."received_value", '')), '\s+', ' ', 'g')) || '|' ||
      n."code" || '|' || n."stage" || '|' || coalesce(n."field", '-')
  WHEN n."tariff_annex_import_id" IS NOT NULL THEN
    'TECH|TARIFF|' || n."tariff_annex_import_id" || '|' || coalesce(n."source_row_number", 0)::text
  WHEN n."import_batch_id" IS NOT NULL THEN
    'TECH|IMP|' || n."import_batch_id" || '|' || coalesce(n."source_row_number", 0)::text
  WHEN n."bulk_update_batch_id" IS NOT NULL THEN
    'TECH|BULK|' || n."bulk_update_batch_id" || '|' || coalesce(n."source_row_number", 0)::text
  ELSE
    'TECH|UNKNOWN|' || n."id"::text
END
FROM tariff_annex_imports ti
WHERE ti."id" = n."tariff_annex_import_id";

-- Filas sin batch asociado (no deberían existir, pero el backfill es total).
UPDATE "novelties" n
SET "logical_key" = 'TECH|UNKNOWN|' || n."id"::text
WHERE n."logical_key" IS NULL;

ALTER TABLE "novelties"
  ALTER COLUMN "logical_key" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "novelties_logical_idx"
  ON "novelties" ("logical_key");
CREATE INDEX IF NOT EXISTS "novelties_logical_attempt_idx"
  ON "novelties" ("logical_key", "attempt_number");
CREATE INDEX IF NOT EXISTS "novelties_logical_active_idx"
  ON "novelties" ("logical_key", "active");
