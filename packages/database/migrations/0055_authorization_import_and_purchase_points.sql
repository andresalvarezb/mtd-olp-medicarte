-- El cargue operativo pertenece a MTD y persiste autorizaciones.
ALTER TABLE "bulk_import_jobs"
  ADD COLUMN "authorization_import_batch_id" uuid REFERENCES "import_batches"("id") ON DELETE RESTRICT;

ALTER TABLE "bulk_import_jobs"
  DROP CONSTRAINT "bulk_import_jobs_type_check",
  ADD CONSTRAINT "bulk_import_jobs_type_check"
    CHECK ("import_type" IN ('AUTHORIZATIONS', 'SCHEDULING'));

ALTER TABLE "projected_demand_lines"
  ALTER COLUMN "dispensing_point_id" DROP NOT NULL;

ALTER TABLE "demand_sources"
  ALTER COLUMN "dispensing_point_id" DROP NOT NULL;
