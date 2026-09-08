-- Failed bulk update batches must not block a retry with the same file.
DROP INDEX IF EXISTS "bulk_update_batches_logical_key_idx";
CREATE UNIQUE INDEX "bulk_update_batches_logical_key_idx"
  ON "bulk_update_batches" ("organization_id", "operation_type", "sha256", "contract_version")
  WHERE "status" <> 'FAILED';
