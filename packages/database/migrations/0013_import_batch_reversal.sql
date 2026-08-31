-- ADR-023 / DEC-017: reversión segura y auditable de cargues de autorizaciones.
-- El batch nunca se elimina: se preserva como evidencia histórica y pasa a REVERTED.

ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_status_check";
ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_status_check"
  CHECK ("status" IN ('UPLOADED', 'VALIDATING', 'READY_TO_CONFIRM', 'CONFIRMING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERTING', 'REVERTED'));

ALTER TABLE "import_batches" ADD COLUMN "reverted_at" timestamptz;
ALTER TABLE "import_batches" ADD COLUMN "reverted_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "import_batches" ADD COLUMN "reverted_removed_items" integer DEFAULT 0 NOT NULL CHECK ("reverted_removed_items" >= 0);
ALTER TABLE "import_batches" ADD COLUMN "reverted_blocked_items" integer DEFAULT 0 NOT NULL CHECK ("reverted_blocked_items" >= 0);

CREATE INDEX "import_batches_reverted_idx" ON "import_batches" ("organization_id", "reverted_at");

INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000024', 'imports.revert', 'Revert an import batch removing only the items it created');

-- El permiso destructivo pertenece únicamente al rol MTD_ADMIN.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000001', "id" FROM "permissions"
WHERE "code" = 'imports.revert';
