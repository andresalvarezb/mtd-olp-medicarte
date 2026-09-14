-- ESP-011: revision-scoped operational outcomes, separate from planning and application.
CREATE TABLE "patient_schedule_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_schedule_id" uuid NOT NULL REFERENCES "patient_schedules"("id") ON DELETE RESTRICT,
  "schedule_revision" integer NOT NULL,
  "authorization_item_id" uuid NOT NULL,
  "outcome" varchar(20) NOT NULL,
  "novelty_code" varchar(40) NOT NULL,
  "occurred_on" date NOT NULL,
  "observation" varchar(1000),
  "prepared_product_disposition" varchar(20) NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patient_schedule_outcomes_authorization_fk"
    FOREIGN KEY ("authorization_item_id") REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "patient_schedule_outcomes_revision_check" CHECK ("schedule_revision" > 0),
  CONSTRAINT "patient_schedule_outcomes_outcome_check" CHECK ("outcome" = 'NOT_APPLIED'),
  CONSTRAINT "patient_schedule_outcomes_novelty_check" CHECK ("novelty_code" IN ('PATIENT_NO_SHOW','INCORRECT_PRESCRIPTION','PRODUCT_NOT_CONTRACTED','AUTHORIZATION_CANCELLED','INSUFFICIENT_STOCK','RESCHEDULED','OTHER')),
  CONSTRAINT "patient_schedule_outcomes_disposition_check" CHECK ("prepared_product_disposition" IN ('NOT_PREPARED','REUSABLE','NON_REUSABLE')),
  CONSTRAINT "patient_schedule_outcomes_other_observation_check" CHECK ("novelty_code" <> 'OTHER' OR ("observation" IS NOT NULL AND length(btrim("observation")) > 0))
);
CREATE UNIQUE INDEX "patient_schedule_outcomes_schedule_revision_unique"
  ON "patient_schedule_outcomes" ("patient_schedule_id", "schedule_revision");
CREATE INDEX "patient_schedule_outcomes_created_idx"
  ON "patient_schedule_outcomes" ("created_at", "occurred_on");

CREATE TABLE "patient_schedule_outcome_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outcome_id" uuid NOT NULL REFERENCES "patient_schedule_outcomes"("id") ON DELETE RESTRICT,
  "inventory_lot_id" uuid NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "lot_number" varchar(255) NOT NULL,
  "expiration_date" date NOT NULL,
  "quantity" integer NOT NULL,
  CONSTRAINT "patient_schedule_outcome_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "patient_schedule_outcome_lines_lot_unique" UNIQUE ("outcome_id", "inventory_lot_id")
);
CREATE INDEX "patient_schedule_outcome_lines_outcome_idx"
  ON "patient_schedule_outcome_lines" ("outcome_id");

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'patient_operational_outcomes.read', 'Read patient operational outcomes'),
  (gen_random_uuid(), 'patient_operational_outcomes.manage', 'Manage patient operational outcomes')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN','MTD_OPERATOR','MTD_GENERAL','MTD_AUDITORIA','READ_ONLY','MEDICARTE_OPERATOR')
  AND p.code = 'patient_operational_outcomes.read'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'MEDICARTE_OPERATOR' AND p.code = 'patient_operational_outcomes.manage'
ON CONFLICT DO NOTHING;
