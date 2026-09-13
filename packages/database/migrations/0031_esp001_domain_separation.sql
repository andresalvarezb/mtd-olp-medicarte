-- ESP-001: separate clinical authorization data from planning and demand.
-- Legacy operational columns remain for historical compatibility and are not
-- used by the new domain model.

ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_id_code_unique"
  UNIQUE ("id", "codigo_medicamento");

COMMENT ON COLUMN "authorization_items"."lugar_dispensacion" IS
  'Legacy historical field. New operations must use dispensing_points.';
COMMENT ON COLUMN "authorization_items"."fecha_programada" IS
  'Legacy historical field. New operations must use patient_schedules.';
COMMENT ON COLUMN "authorization_items"."fecha_dispensacion" IS
  'Legacy historical field. New operations must not write this column.';
COMMENT ON COLUMN "authorization_items"."fecha_aplicacion" IS
  'Legacy historical field. New operations must use patient_applications.';
COMMENT ON COLUMN "authorization_items"."orden_compra" IS
  'Legacy historical field. New operations must use purchase_orders.';

CREATE TABLE "dispensing_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "code" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "dispensing_points_code_not_blank_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "dispensing_points_name_not_blank_check" CHECK (length(btrim("name")) > 0)
);
CREATE UNIQUE INDEX "dispensing_points_organization_code_idx"
  ON "dispensing_points" ("organization_id", "code");
CREATE INDEX "dispensing_points_active_idx"
  ON "dispensing_points" ("organization_id", "active", "code");

CREATE TABLE "planning_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "programming_deadline_at" timestamptz NOT NULL,
  "purchase_order_deadline_at" timestamptz NOT NULL,
  "expected_delivery_date" date NOT NULL,
  "status" varchar(30) DEFAULT 'OPEN' NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "planning_periods_date_range_check" CHECK ("start_date" <= "end_date"),
  CONSTRAINT "planning_periods_deadline_order_check"
    CHECK ("programming_deadline_at" <= "purchase_order_deadline_at"),
  CONSTRAINT "planning_periods_status_check"
    CHECK ("status" IN ('OPEN', 'PLANNING_CLOSED', 'PURCHASING', 'IN_FULFILLMENT', 'OPERATIONAL', 'CLOSED'))
);
CREATE INDEX "planning_periods_status_start_idx"
  ON "planning_periods" ("status", "start_date");

CREATE TABLE "patient_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_item_id" uuid NOT NULL,
  "planning_period_id" uuid NOT NULL REFERENCES "planning_periods"("id") ON DELETE RESTRICT,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "scheduled_date" date NOT NULL,
  "quantity" integer NOT NULL,
  "status" varchar(20) DEFAULT 'SCHEDULED' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patient_schedules_authorization_code_fk"
    FOREIGN KEY ("authorization_item_id", "commercial_code")
    REFERENCES "authorization_items" ("id", "codigo_medicamento") ON DELETE RESTRICT,
  CONSTRAINT "patient_schedules_commercial_code_not_blank_check"
    CHECK (length(btrim("commercial_code")) > 0),
  CONSTRAINT "patient_schedules_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "patient_schedules_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "patient_schedules_status_check"
    CHECK ("status" IN ('SCHEDULED', 'CANCELLED'))
);
CREATE INDEX "patient_schedules_period_point_date_idx"
  ON "patient_schedules" ("planning_period_id", "dispensing_point_id", "scheduled_date", "status");
CREATE INDEX "patient_schedules_authorization_created_idx"
  ON "patient_schedules" ("authorization_item_id", "created_at");

CREATE TABLE "patient_schedule_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_schedule_id" uuid NOT NULL REFERENCES "patient_schedules"("id") ON DELETE RESTRICT,
  "revision" integer NOT NULL,
  "authorization_item_id" uuid NOT NULL,
  "planning_period_id" uuid NOT NULL REFERENCES "planning_periods"("id") ON DELETE RESTRICT,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "scheduled_date" date NOT NULL,
  "quantity" integer NOT NULL,
  "status" varchar(20) NOT NULL,
  "change_type" varchar(30) NOT NULL,
  "changed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "correlation_id" uuid NOT NULL,
  "changed_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patient_schedule_history_schedule_revision_unique"
    UNIQUE ("patient_schedule_id", "revision"),
  CONSTRAINT "patient_schedule_history_authorization_code_fk"
    FOREIGN KEY ("authorization_item_id", "commercial_code")
    REFERENCES "authorization_items" ("id", "codigo_medicamento") ON DELETE RESTRICT,
  CONSTRAINT "patient_schedule_history_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "patient_schedule_history_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "patient_schedule_history_status_check"
    CHECK ("status" IN ('SCHEDULED', 'CANCELLED'))
);
CREATE INDEX "patient_schedule_history_schedule_changed_idx"
  ON "patient_schedule_history" ("patient_schedule_id", "changed_at");

CREATE OR REPLACE FUNCTION prevent_patient_schedule_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'patient_schedule_history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patient_schedule_history_no_update
  BEFORE UPDATE ON "patient_schedule_history"
  FOR EACH ROW EXECUTE FUNCTION prevent_patient_schedule_history_mutation();
CREATE TRIGGER patient_schedule_history_no_delete
  BEFORE DELETE ON "patient_schedule_history"
  FOR EACH ROW EXECUTE FUNCTION prevent_patient_schedule_history_mutation();

CREATE TABLE "projected_demand_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "planning_period_id" uuid NOT NULL REFERENCES "planning_periods"("id") ON DELETE RESTRICT,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "projected_quantity" integer NOT NULL,
  "status" varchar(20) DEFAULT 'OPEN' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "consolidated_at" timestamptz,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "projected_demand_lines_period_point_code_unique"
    UNIQUE ("planning_period_id", "dispensing_point_id", "commercial_code"),
  CONSTRAINT "projected_demand_lines_commercial_code_not_blank_check"
    CHECK (length(btrim("commercial_code")) > 0),
  CONSTRAINT "projected_demand_lines_quantity_check" CHECK ("projected_quantity" > 0),
  CONSTRAINT "projected_demand_lines_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "projected_demand_lines_status_check"
    CHECK ("status" IN ('OPEN', 'FROZEN', 'CLOSED'))
);
CREATE INDEX "projected_demand_lines_period_status_idx"
  ON "projected_demand_lines" ("planning_period_id", "status");

CREATE TABLE "demand_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projected_demand_line_id" uuid NOT NULL REFERENCES "projected_demand_lines"("id") ON DELETE RESTRICT,
  "patient_schedule_id" uuid NOT NULL,
  "schedule_revision" integer NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "demand_sources_schedule_revision_fk"
    FOREIGN KEY ("patient_schedule_id", "schedule_revision")
    REFERENCES "patient_schedule_history" ("patient_schedule_id", "revision") ON DELETE RESTRICT,
  CONSTRAINT "demand_sources_schedule_revision_unique"
    UNIQUE ("patient_schedule_id", "schedule_revision"),
  CONSTRAINT "demand_sources_schedule_revision_check" CHECK ("schedule_revision" > 0),
  CONSTRAINT "demand_sources_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "demand_sources_demand_line_idx"
  ON "demand_sources" ("projected_demand_line_id", "created_at");
