-- El cargue operativo pertenece a MTD y persiste autorizaciones.
ALTER TABLE "bulk_import_jobs"
  ADD COLUMN "authorization_import_batch_id" uuid REFERENCES "import_batches"("id") ON DELETE RESTRICT;

ALTER TABLE "bulk_import_jobs"
  DROP CONSTRAINT "bulk_import_jobs_type_check",
  ADD CONSTRAINT "bulk_import_jobs_type_check"
    CHECK ("import_type" IN ('AUTHORIZATIONS', 'SCHEDULING'));

DELETE FROM "role_permissions"
 WHERE "permission_id" = (SELECT id FROM permissions WHERE code = 'bulk_imports.manage')
   AND "role_id" IN (SELECT id FROM roles WHERE code = 'MEDICARTE_OPERATOR');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.code IN ('MTD_ADMIN', 'MTD_OPERATOR')
   AND p.code = 'bulk_imports.manage'
ON CONFLICT DO NOTHING;

ALTER TABLE "projected_demand_lines"
  ALTER COLUMN "dispensing_point_id" DROP NOT NULL;

ALTER TABLE "demand_sources"
  ALTER COLUMN "dispensing_point_id" DROP NOT NULL;

ALTER TABLE "projected_demand_lines"
  DROP CONSTRAINT "projected_demand_lines_identity_unique",
  ADD CONSTRAINT "projected_demand_lines_period_code_unique"
    UNIQUE ("planning_period_id", "commercial_code");
