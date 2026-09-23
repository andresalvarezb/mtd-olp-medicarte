-- ESP-014 hardening: durable row claim tokens, generations and leases.
-- PostgreSQL coordinates multi-instance confirm. No operational fact tables.

ALTER TABLE "bulk_import_jobs"
  ADD COLUMN IF NOT EXISTS "processing_generation" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing_token" uuid,
  ADD COLUMN IF NOT EXISTS "processing_heartbeat_at" timestamptz;

ALTER TABLE "bulk_import_rows"
  ADD COLUMN IF NOT EXISTS "claim_token" uuid,
  ADD COLUMN IF NOT EXISTS "claim_generation" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "claimed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "claim_expires_at" timestamptz;

ALTER TABLE "bulk_import_jobs"
  DROP CONSTRAINT IF EXISTS "bulk_import_jobs_processing_generation_check";
ALTER TABLE "bulk_import_jobs"
  ADD CONSTRAINT "bulk_import_jobs_processing_generation_check"
  CHECK ("processing_generation" >= 0);

ALTER TABLE "bulk_import_rows"
  DROP CONSTRAINT IF EXISTS "bulk_import_rows_claim_generation_check";
ALTER TABLE "bulk_import_rows"
  ADD CONSTRAINT "bulk_import_rows_claim_generation_check"
  CHECK ("claim_generation" >= 0);

CREATE INDEX IF NOT EXISTS "bulk_import_rows_claim_idx"
  ON "bulk_import_rows" ("job_id", "execution_status", "claim_expires_at");
