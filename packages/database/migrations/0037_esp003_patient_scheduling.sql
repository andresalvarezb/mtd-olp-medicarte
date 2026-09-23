-- ESP-003: programación de pacientes por Medicarte.
-- Migración aditiva sobre ESP-002 (0032). No toca authorization_items ni
-- projected_demand_lines: la programación solo registra la intención clínica
-- de aplicar un producto autorizado, con período, punto, fecha y cantidad.
--
-- Decisiones (ver ADR-030):
-- * `schedule_timing` congela la clasificación ON_TIME/LATE calculada con la
--   regla pura de ESP-002 (`classifyScheduleTiming`) al momento de programar.
-- * `late_handling` es obligatorio cuando la programación es LATE y nulo en
--   ON_TIME. Es solo intención operativa: ESP-003 no crea ni modifica OC.
-- * Cuando late_handling = NEXT_PERIOD, `deferred_planning_period_id`
--   referencia el período que deberá recibir la materialización (ESP-004).
-- * `revision` es a la vez token de concurrencia optimista y número de
--   snapshot append-only en patient_schedule_history.
-- * El staging de XLSX usa tablas propias con estados
--   VALID/INVALID/DUPLICATE/CONFLICT y confirmación transaccional por fila.

ALTER TABLE "patient_schedules"
  ADD COLUMN "schedule_timing" varchar(10) DEFAULT 'ON_TIME' NOT NULL,
  ADD COLUMN "late_handling" varchar(40),
  ADD COLUMN "deferred_planning_period_id" uuid REFERENCES "planning_periods"("id") ON DELETE RESTRICT;

ALTER TABLE "patient_schedules"
  DROP CONSTRAINT "patient_schedules_status_check";

ALTER TABLE "patient_schedules"
  ADD CONSTRAINT "patient_schedules_status_check"
    CHECK ("status" IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED')),
  ADD CONSTRAINT "patient_schedules_schedule_timing_check"
    CHECK ("schedule_timing" IN ('ON_TIME', 'LATE')),
  ADD CONSTRAINT "patient_schedules_late_handling_check"
    CHECK ("late_handling" IS NULL OR "late_handling" IN ('COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD')),
  ADD CONSTRAINT "patient_schedules_late_handling_coherence_check"
    CHECK (
      ("schedule_timing" = 'LATE' AND "late_handling" IS NOT NULL) OR
      ("schedule_timing" = 'ON_TIME' AND "late_handling" IS NULL)
    ),
  ADD CONSTRAINT "patient_schedules_deferred_period_check"
    CHECK (
      ("late_handling" = 'NEXT_PERIOD' AND "deferred_planning_period_id" IS NOT NULL) OR
      ("late_handling" IS DISTINCT FROM 'NEXT_PERIOD' AND "deferred_planning_period_id" IS NULL)
    );

CREATE INDEX "patient_schedules_commercial_status_idx"
  ON "patient_schedules" ("commercial_code", "status");
CREATE INDEX "patient_schedules_point_date_status_idx"
  ON "patient_schedules" ("dispensing_point_id", "scheduled_date", "status");

ALTER TABLE "patient_schedule_history"
  ADD COLUMN "schedule_timing" varchar(10) DEFAULT 'ON_TIME' NOT NULL,
  ADD COLUMN "late_handling" varchar(40),
  ADD COLUMN "deferred_planning_period_id" uuid REFERENCES "planning_periods"("id") ON DELETE RESTRICT;

ALTER TABLE "patient_schedule_history"
  DROP CONSTRAINT "patient_schedule_history_status_check";

ALTER TABLE "patient_schedule_history"
  ADD CONSTRAINT "patient_schedule_history_status_check"
    CHECK ("status" IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED')),
  ADD CONSTRAINT "patient_schedule_history_schedule_timing_check"
    CHECK ("schedule_timing" IN ('ON_TIME', 'LATE')),
  ADD CONSTRAINT "patient_schedule_history_late_handling_check"
    CHECK ("late_handling" IS NULL OR "late_handling" IN ('COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD')),
  ADD CONSTRAINT "patient_schedule_history_late_handling_coherence_check"
    CHECK (
      ("schedule_timing" = 'LATE' AND "late_handling" IS NOT NULL) OR
      ("schedule_timing" = 'ON_TIME' AND "late_handling" IS NULL)
    );

CREATE TABLE "patient_schedule_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "status" varchar(30) DEFAULT 'UPLOADED' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "valid_rows" integer DEFAULT 0 NOT NULL,
  "invalid_rows" integer DEFAULT 0 NOT NULL,
  "duplicate_rows" integer DEFAULT 0 NOT NULL,
  "conflict_rows" integer DEFAULT 0 NOT NULL,
  "confirmed_rows" integer DEFAULT 0 NOT NULL,
  "correlation_id" uuid NOT NULL,
  "last_error_code" varchar(80),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  "confirmed_at" timestamptz,
  CONSTRAINT "patient_schedule_imports_size_bytes_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520),
  CONSTRAINT "patient_schedule_imports_status_check"
    CHECK ("status" IN ('UPLOADED', 'VALIDATING', 'READY_TO_CONFIRM', 'CONFIRMING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "patient_schedule_imports_total_rows_check" CHECK ("total_rows" >= 0),
  CONSTRAINT "patient_schedule_imports_valid_rows_check" CHECK ("valid_rows" >= 0),
  CONSTRAINT "patient_schedule_imports_invalid_rows_check" CHECK ("invalid_rows" >= 0),
  CONSTRAINT "patient_schedule_imports_duplicate_rows_check" CHECK ("duplicate_rows" >= 0),
  CONSTRAINT "patient_schedule_imports_conflict_rows_check" CHECK ("conflict_rows" >= 0),
  CONSTRAINT "patient_schedule_imports_confirmed_rows_check" CHECK ("confirmed_rows" >= 0)
);
CREATE INDEX "patient_schedule_imports_org_status_idx"
  ON "patient_schedule_imports" ("organization_id", "status", "created_at");

CREATE TABLE "patient_schedule_import_source_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL UNIQUE REFERENCES "patient_schedule_imports"("id") ON DELETE CASCADE,
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "content" bytea,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "processed_at" timestamptz
);

CREATE TABLE "patient_schedule_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL REFERENCES "patient_schedule_imports"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "raw_data" jsonb NOT NULL,
  "normalized_data" jsonb,
  "staging_status" varchar(20) NOT NULL,
  "result_code" varchar(80) NOT NULL,
  "result_message" text,
  "patient_document" varchar(80),
  "authorization_number" varchar(255),
  "commercial_code" varchar(255),
  "quantity" integer,
  "dispensing_point_code" varchar(80),
  "scheduled_date" date,
  "authorization_item_id" uuid REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "planning_period_id" uuid REFERENCES "planning_periods"("id") ON DELETE RESTRICT,
  "dispensing_point_id" uuid REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "schedule_timing" varchar(10),
  "late_handling" varchar(40),
  "deferred_planning_period_id" uuid REFERENCES "planning_periods"("id") ON DELETE RESTRICT,
  "confirmable" boolean DEFAULT false NOT NULL,
  "patient_schedule_id" uuid REFERENCES "patient_schedules"("id") ON DELETE RESTRICT,
  "confirmed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patient_schedule_import_rows_import_row_unique" UNIQUE ("import_id", "row_number"),
  CONSTRAINT "patient_schedule_import_rows_row_number_check" CHECK ("row_number" > 0),
  CONSTRAINT "patient_schedule_import_rows_staging_status_check"
    CHECK ("staging_status" IN ('VALID', 'INVALID', 'DUPLICATE', 'CONFLICT')),
  CONSTRAINT "patient_schedule_import_rows_result_code_check"
    CHECK ("result_code" IN (
      'ROW_VALID', 'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_FORMAT',
      'DUPLICATE_IN_FILE', 'DUPLICATE_EXISTING_SCHEDULE',
      'AUTHORIZATION_ITEM_NOT_FOUND', 'AUTHORIZATION_CODE_MISMATCH',
      'PATIENT_DOCUMENT_MISMATCH',
      'AUTHORIZATION_NOT_SCHEDULABLE', 'AUTHORIZATION_EXPIRED',
      'INVALID_QUANTITY', 'DISPENSING_POINT_NOT_FOUND',
      'PLANNING_PERIOD_NOT_FOUND', 'NEXT_PERIOD_NOT_FOUND',
      'LATE_HANDLING_REQUIRED', 'INVALID_HEADERS', 'PROCESSING_ERROR',
      'CONFIRMATION_CONFLICT'
    )),
  CONSTRAINT "patient_schedule_import_rows_quantity_check"
    CHECK ("quantity" IS NULL OR "quantity" > 0)
);
CREATE INDEX "patient_schedule_import_rows_status_idx"
  ON "patient_schedule_import_rows" ("import_id", "staging_status", "row_number");

-- RBAC del módulo. La matriz inicial vive en ADR-030: Medicarte administra;
-- MTD y READ_ONLY consultan; OLP y COMPENSAR no reciben permisos.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'patient_schedules.read', 'Read patient schedules and scheduling searches'),
  (gen_random_uuid(), 'patient_schedules.manage', 'Create, reschedule and cancel patient schedules')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN (
    'MEDICARTE_OPERATOR', 'MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'
  )
  AND p."code" = 'patient_schedules.read'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'MEDICARTE_OPERATOR'
  AND p."code" = 'patient_schedules.manage'
ON CONFLICT DO NOTHING;
