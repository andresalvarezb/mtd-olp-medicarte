-- ADR-027: clasificacion transversal del error por registro. El catalogo
-- novelty_codes gana el tipo de error; el codigo TECnico estable hace la
-- bandeja reprocesable sin recargar el archivo original.
ALTER TABLE "novelty_codes" ADD COLUMN IF NOT EXISTS "error_type" varchar(32);

INSERT INTO "novelty_codes" ("code", "stage", "field", "description") VALUES
  ('TECH_001', 'OPERACION', null, 'Error tecnico durante el procesamiento; el registro no fue alterado y puede reprocesarse sin recargar el archivo.'),
  ('SRC_001', 'AUTORIZACIONES', 'ESTADO_AUTORIZACION', 'El estado de origen de la autorizacion no habilita el registro.')
ON CONFLICT ("code") DO NOTHING;

UPDATE "novelty_codes" SET "error_type" = CASE "code"
  WHEN 'CSV_001' THEN 'REPROCESABLE_INTERNAMENTE'
  WHEN 'CSV_002' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'CSV_003' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'CSV_004' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'CSV_005' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'AUTH_001' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'AUTH_002' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'AUTH_003' THEN 'REQUIERE_VALIDACION'
  WHEN 'AUTH_004' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'ANX_001' THEN 'REPROCESABLE_INTERNAMENTE'
  WHEN 'ANX_002' THEN 'REPROCESABLE_INTERNAMENTE'
  WHEN 'ANX_003' THEN 'REPROCESABLE_INTERNAMENTE'
  WHEN 'CLS_001' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'CLS_002' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'MIP_001' THEN 'REQUIERE_VALIDACION'
  WHEN 'MED_001' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'MED_002' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'MTD_001' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'OLP_001' THEN 'CORREGIBLE_POR_CARGUE'
  WHEN 'AUD_001' THEN 'REQUIERE_VALIDACION'
  WHEN 'LOCK_001' THEN 'REQUIERE_VALIDACION'
  WHEN 'CONC_001' THEN 'REPROCESABLE_INTERNAMENTE'
  WHEN 'MIG_001' THEN 'REQUIERE_VALIDACION'
  WHEN 'TECH_001' THEN 'REPROCESABLE_INTERNAMENTE'
  WHEN 'SRC_001' THEN 'CORREGIBLE_POR_CARGUE'
  ELSE 'REQUIERE_VALIDACION'
END
WHERE "error_type" IS NULL;

ALTER TABLE "novelty_codes" ALTER COLUMN "error_type" SET NOT NULL;

ALTER TABLE "novelties" ADD COLUMN IF NOT EXISTS "tariff_annex_import_id" uuid REFERENCES "tariff_annex_imports"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "novelties_tariff_batch_idx" ON "novelties" ("tariff_annex_import_id", "processed_at");

ALTER TABLE "novelty_codes" DROP CONSTRAINT IF EXISTS "novelty_codes_error_type_check";
ALTER TABLE "novelty_codes" ADD CONSTRAINT "novelty_codes_error_type_check" CHECK ("error_type" IN (
  'CORREGIBLE_POR_CARGUE', 'REQUIERE_VALIDACION', 'REPROCESABLE_INTERNAMENTE'
));

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'authorizations.reprocess', 'Reprocess halted authorization records without a new file load')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR') AND p."code" = 'authorizations.reprocess'
ON CONFLICT DO NOTHING;
