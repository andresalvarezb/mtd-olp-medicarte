-- RF-PAC-001 Etapa 4: durable batch ledger, item provenance and reconciliation.
-- No source_data, operational fields, or identity values are copied here.
CREATE INDEX "patients_identification_raw_idx"
  ON "patients" ("identification_type_raw", "identification_value_raw");

CREATE TABLE "patient_backfill_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "policy_version" varchar(120) NOT NULL,
  "status" varchar(30) DEFAULT 'PENDING' NOT NULL,
  "batch_size" integer NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error_code" varchar(80),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "reverted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patient_backfill_batches_status_check"
    CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'REVERTED')),
  CONSTRAINT "patient_backfill_batches_size_check"
    CHECK ("batch_size" BETWEEN 1 AND 500),
  CONSTRAINT "patient_backfill_batches_policy_not_blank_check"
    CHECK (length(btrim("policy_version")) > 0)
);

CREATE INDEX "patient_backfill_batches_org_created_idx"
  ON "patient_backfill_batches" ("organization_id", "created_at");

CREATE TABLE "patient_backfill_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL REFERENCES "patient_backfill_batches"("id") ON DELETE RESTRICT,
  "authorization_item_id" uuid NOT NULL REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "status" varchar(30) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "previous_patient_id" uuid REFERENCES "patients"("id") ON DELETE RESTRICT,
  "applied_patient_id" uuid REFERENCES "patients"("id") ON DELETE RESTRICT,
  "created_patient" boolean DEFAULT false NOT NULL,
  "resolution_code" varchar(80),
  "decision_reference" varchar(255),
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_at" timestamptz,
  "processed_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patient_backfill_items_batch_authorization_uq"
    UNIQUE ("batch_id", "authorization_item_id"),
  CONSTRAINT "patient_backfill_items_status_check"
    CHECK ("status" IN ('LINKED', 'ALREADY_LINKED', 'NEEDS_RECONCILIATION', 'CONFLICT', 'RESOLVED', 'REVERTED', 'REVERT_CONFLICT')),
  CONSTRAINT "patient_backfill_items_reconciliation_decision_check"
    CHECK (
      (
        ("resolution_code" IS NULL AND "decision_reference" IS NULL AND "decided_by" IS NULL AND "decided_at" IS NULL)
        OR
        ("resolution_code" IS NOT NULL AND "decision_reference" IS NOT NULL AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
      )
      AND ("status" <> 'RESOLVED' OR "resolution_code" IS NOT NULL)
    ),
  CONSTRAINT "patient_backfill_items_link_provenance_check"
    CHECK (
      ("status" NOT IN ('LINKED', 'ALREADY_LINKED', 'REVERTED', 'REVERT_CONFLICT') OR "applied_patient_id" IS NOT NULL)
      AND ("status" <> 'LINKED' OR "previous_patient_id" IS NULL)
      AND ("status" <> 'ALREADY_LINKED' OR ("previous_patient_id" IS NOT NULL AND "previous_patient_id" = "applied_patient_id"))
    )
);

CREATE INDEX "patient_backfill_items_batch_status_idx"
  ON "patient_backfill_items" ("batch_id", "status");
CREATE INDEX "patient_backfill_items_authorization_idx"
  ON "patient_backfill_items" ("authorization_item_id");
