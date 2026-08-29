CREATE TABLE "import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size_bytes" integer NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520),
  "sha256" varchar(64) NOT NULL,
  "processor_version" integer NOT NULL CHECK ("processor_version" > 0),
  "status" varchar(30) DEFAULT 'UPLOADED' NOT NULL CHECK ("status" IN ('UPLOADED', 'VALIDATING', 'READY_TO_CONFIRM', 'CONFIRMING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  "total_rows" integer DEFAULT 0 NOT NULL CHECK ("total_rows" >= 0),
  "valid_rows" integer DEFAULT 0 NOT NULL CHECK ("valid_rows" >= 0),
  "rejected_rows" integer DEFAULT 0 NOT NULL CHECK ("rejected_rows" >= 0),
  "duplicate_rows" integer DEFAULT 0 NOT NULL CHECK ("duplicate_rows" >= 0),
  "existing_rows" integer DEFAULT 0 NOT NULL CHECK ("existing_rows" >= 0),
  "confirmed_rows" integer DEFAULT 0 NOT NULL CHECK ("confirmed_rows" >= 0),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "confirmed_at" timestamptz,
  "last_error_code" varchar(80)
);

CREATE INDEX "import_batches_status_idx" ON "import_batches" ("organization_id", "status", "created_at");
CREATE INDEX "import_batches_hash_idx" ON "import_batches" ("sha256");

CREATE TABLE "authorization_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "numero_autorizacion" varchar(255) NOT NULL,
  "codigo_medicamento" varchar(255) NOT NULL,
  "authorization_key" varchar(511) NOT NULL,
  "source_data" jsonb NOT NULL,
  "source_status_normalized" varchar(80) NOT NULL,
  "source_cups_principal_normalized" varchar(255) NOT NULL,
  "enablement_status" varchar(40) NOT NULL CHECK ("enablement_status" IN ('ENABLED', 'BLOCKED_SOURCE_STATUS')),
  "coverage_type" varchar(30) NOT NULL CHECK ("coverage_type" IN ('PBS', 'NO_PBS')),
  "direction_status" varchar(30) NOT NULL CHECK ("direction_status" IN ('NOT_APPLICABLE', 'PENDING', 'CONFIRMED', 'QUERY_ERROR')),
  "operation_status" varchar(40) CHECK ("operation_status" IS NULL OR "operation_status" IN ('BLOCKED', 'READY_TO_DISPENSE', 'DISPENSATION_REPORTED', 'DISPENSED')),
  "coverage_rule_version" varchar(40) NOT NULL,
  "created_from_batch_id" uuid NOT NULL REFERENCES "import_batches"("id") ON DELETE RESTRICT,
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "authorization_items_identity_idx" ON "authorization_items" ("numero_autorizacion", "codigo_medicamento");
CREATE INDEX "authorization_items_coverage_idx" ON "authorization_items" ("coverage_type", "enablement_status");
CREATE INDEX "authorization_items_created_idx" ON "authorization_items" ("created_at", "id");

CREATE TABLE "coverage_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_item_id" uuid NOT NULL REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "evaluation_version" integer NOT NULL CHECK ("evaluation_version" > 0),
  "source_value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "coverage_type" varchar(30) NOT NULL CHECK ("coverage_type" IN ('PBS', 'NO_PBS')),
  "rule_version" varchar(40) NOT NULL,
  "evaluated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "coverage_evaluations_item_version_idx" ON "coverage_evaluations" ("authorization_item_id", "evaluation_version");

CREATE TABLE "authorization_item_organizations" (
  "authorization_item_id" uuid NOT NULL REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "authorization_item_organizations_pk" PRIMARY KEY ("authorization_item_id", "organization_id")
);

CREATE INDEX "authorization_item_organizations_org_idx" ON "authorization_item_organizations" ("organization_id", "authorization_item_id");

CREATE TABLE "import_source_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id") ON DELETE CASCADE,
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size_bytes" integer NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520),
  "sha256" varchar(64) NOT NULL,
  "content" bytea,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "processed_at" timestamptz
);

CREATE UNIQUE INDEX "import_source_files_batch_idx" ON "import_source_files" ("import_batch_id");

CREATE TABLE "import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL CHECK ("row_number" > 0),
  "raw_data" jsonb NOT NULL,
  "normalized_data" jsonb,
  "authorization_key" varchar(511),
  "result_code" varchar(80) NOT NULL CHECK ("result_code" IN ('ROW_VALID', 'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_FORMAT', 'DUPLICATE_IN_FILE', 'EXISTING_ITEM_REVIEW_REQUIRED', 'EXPLICIT_UPDATE_NOT_ALLOWED', 'ITEM_CREATED', 'ITEM_UPDATED', 'PROCESSING_ERROR')),
  "result_message" text NOT NULL,
  "confirmable" boolean DEFAULT false NOT NULL,
  "authorization_item_id" uuid REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "import_rows_batch_row_unique" UNIQUE ("import_batch_id", "row_number")
);

CREATE INDEX "import_rows_batch_result_idx" ON "import_rows" ("import_batch_id", "result_code", "row_number");

CREATE TABLE "validation_errors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_row_id" uuid NOT NULL REFERENCES "import_rows"("id") ON DELETE CASCADE,
  "field_name" varchar(160) NOT NULL,
  "code" varchar(80) NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "validation_errors_row_idx" ON "validation_errors" ("import_row_id");

CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" ("expires_at");
