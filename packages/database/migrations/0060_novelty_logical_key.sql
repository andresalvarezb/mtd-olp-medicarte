ALTER TABLE "novelties"
  ADD COLUMN IF NOT EXISTS "logical_key" varchar(500);

UPDATE "novelties" n
SET "logical_key" = CASE
  WHEN n."authorization_item_id" IS NOT NULL THEN
    'ITEM|' || n."authorization_item_id" || '|' || n."code" || '|' || n."stage" || '|' || coalesce(n."field", '-')
  WHEN n."tariff_annex_import_id" IS NOT NULL
       AND btrim(coalesce(
         n."original_row"->>'CODIGO_PRODUCTO',
         n."original_row"->>'CODIGO_MEDICAMENTO',
         n."original_row"->>'CODIGO_COMERCIAL',
         n."received_value",
         ''
       )) <> '' THEN
    'TARIFF|' || ti."organization_id" || '|' ||
      upper(regexp_replace(btrim(coalesce(
        n."original_row"->>'CODIGO_PRODUCTO',
        n."original_row"->>'CODIGO_MEDICAMENTO',
        n."original_row"->>'CODIGO_COMERCIAL',
        n."received_value",
        ''
      )), '\s+', ' ', 'g')) || '|' || n."code" || '|' || n."stage" || '|' || coalesce(n."field", '-')
  WHEN n."tariff_annex_import_id" IS NOT NULL THEN
    'TECH|TARIFF|' || n."tariff_annex_import_id" || '|' || coalesce(n."source_row_number", 0)::text
  WHEN n."import_batch_id" IS NOT NULL THEN
    'TECH|IMP|' || n."import_batch_id" || '|' || coalesce(n."source_row_number", 0)::text
  WHEN n."bulk_update_batch_id" IS NOT NULL THEN
    'TECH|BULK|' || n."bulk_update_batch_id" || '|' || coalesce(n."source_row_number", 0)::text
  ELSE
    'TECH|UNKNOWN|' || n."id"::text
END
FROM "tariff_annex_imports" ti
WHERE ti."id" = n."tariff_annex_import_id"
  AND n."logical_key" IS NULL;

UPDATE "novelties" n
SET "logical_key" = CASE
  WHEN n."authorization_item_id" IS NOT NULL THEN
    'ITEM|' || n."authorization_item_id" || '|' || n."code" || '|' || n."stage" || '|' || coalesce(n."field", '-')
  WHEN n."import_batch_id" IS NOT NULL THEN
    'TECH|IMP|' || n."import_batch_id" || '|' || coalesce(n."source_row_number", 0)::text
  WHEN n."bulk_update_batch_id" IS NOT NULL THEN
    'TECH|BULK|' || n."bulk_update_batch_id" || '|' || coalesce(n."source_row_number", 0)::text
  ELSE
    'TECH|UNKNOWN|' || n."id"::text
END
WHERE n."logical_key" IS NULL;

ALTER TABLE "novelties"
  ALTER COLUMN "logical_key" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "novelties_logical_idx"
  ON "novelties" ("logical_key");
CREATE INDEX IF NOT EXISTS "novelties_logical_attempt_idx"
  ON "novelties" ("logical_key", "attempt_number");
CREATE INDEX IF NOT EXISTS "novelties_logical_active_idx"
  ON "novelties" ("logical_key", "active");
