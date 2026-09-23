-- ESP-014: bulk import staging for XLSX transport. No operational fact tables.
-- Exports remain read-only; they do not persist.

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'bulk_imports.read', 'Read bulk import jobs and row results'),
  (gen_random_uuid(), 'bulk_imports.manage', 'Upload, confirm, cancel and retry bulk imports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MEDICARTE_OPERATOR', 'MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY')
  AND p.code = 'bulk_imports.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'MEDICARTE_OPERATOR'
  AND p.code = 'bulk_imports.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE "bulk_import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "import_type" varchar(40) NOT NULL,
  "template_version" varchar(80) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'UPLOADED',
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size_bytes" integer NOT NULL,
  "file_hash" varchar(64) NOT NULL,
  "duplicate_file" boolean NOT NULL DEFAULT false,
  "total_rows" integer NOT NULL DEFAULT 0,
  "valid_rows" integer NOT NULL DEFAULT 0,
  "invalid_rows" integer NOT NULL DEFAULT 0,
  "duplicate_rows" integer NOT NULL DEFAULT 0,
  "warning_rows" integer NOT NULL DEFAULT 0,
  "succeeded_rows" integer NOT NULL DEFAULT 0,
  "failed_rows" integer NOT NULL DEFAULT 0,
  "skipped_rows" integer NOT NULL DEFAULT 0,
  "last_error_code" varchar(80),
  "correlation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "validated_at" timestamptz,
  "confirmed_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "failed_at" timestamptz,
  CONSTRAINT "bulk_import_jobs_type_check" CHECK ("import_type" = 'SCHEDULING'),
  CONSTRAINT "bulk_import_jobs_status_check" CHECK ("status" IN (
    'UPLOADED', 'VALIDATING', 'READY', 'INVALID', 'PROCESSING',
    'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'
  )),
  CONSTRAINT "bulk_import_jobs_size_bytes_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520),
  CONSTRAINT "bulk_import_jobs_counts_check" CHECK (
    "total_rows" >= 0 AND "valid_rows" >= 0 AND "invalid_rows" >= 0
    AND "duplicate_rows" >= 0 AND "warning_rows" >= 0
    AND "succeeded_rows" >= 0 AND "failed_rows" >= 0 AND "skipped_rows" >= 0
  )
);

CREATE INDEX "bulk_import_jobs_org_status_idx"
  ON "bulk_import_jobs" ("organization_id", "status", "created_at");
CREATE INDEX "bulk_import_jobs_hash_idx"
  ON "bulk_import_jobs" ("created_by", "file_hash");

CREATE TABLE "bulk_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL REFERENCES "bulk_import_jobs"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "raw_payload" jsonb NOT NULL,
  "normalized_payload" jsonb,
  "validation_status" varchar(20) NOT NULL,
  "error_code" varchar(80),
  "error_message" text,
  "error_column" varchar(80),
  "entity_reference" uuid,
  "execution_status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "execution_error_code" varchar(80),
  "execution_error" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "idempotency_key" varchar(200) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "executed_at" timestamptz,
  CONSTRAINT "bulk_import_rows_job_row_unique" UNIQUE ("job_id", "row_number"),
  CONSTRAINT "bulk_import_rows_idempotency_unique" UNIQUE ("idempotency_key"),
  CONSTRAINT "bulk_import_rows_row_number_check" CHECK ("row_number" > 0),
  CONSTRAINT "bulk_import_rows_validation_status_check"
    CHECK ("validation_status" IN ('VALID', 'INVALID', 'DUPLICATE', 'CONFLICT')),
  CONSTRAINT "bulk_import_rows_execution_status_check"
    CHECK ("execution_status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  CONSTRAINT "bulk_import_rows_attempt_count_check" CHECK ("attempt_count" >= 0)
);

CREATE INDEX "bulk_import_rows_job_status_idx"
  ON "bulk_import_rows" ("job_id", "validation_status", "execution_status", "row_number");

CREATE TABLE "bulk_import_row_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "row_id" uuid NOT NULL REFERENCES "bulk_import_rows"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "status" varchar(20) NOT NULL,
  "error_code" varchar(80),
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bulk_import_row_attempts_unique" UNIQUE ("row_id", "attempt_number"),
  CONSTRAINT "bulk_import_row_attempts_number_check" CHECK ("attempt_number" > 0),
  CONSTRAINT "bulk_import_row_attempts_status_check"
    CHECK ("status" IN ('SUCCEEDED', 'FAILED', 'SKIPPED'))
);
