-- ESP-010: patient applications consume the operational inventory ledger.
CREATE TABLE "patient_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_schedule_id" uuid NOT NULL REFERENCES "patient_schedules"("id") ON DELETE RESTRICT,
  "schedule_revision" integer NOT NULL,
  "authorization_item_id" uuid NOT NULL,
  "commercial_code" varchar(255) NOT NULL,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "scheduled_date" date NOT NULL,
  "application_date" date NOT NULL,
  "status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "confirmed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "confirmed_at" timestamptz,
  CONSTRAINT "patient_applications_authorization_code_fk"
    FOREIGN KEY ("authorization_item_id", "commercial_code")
    REFERENCES "authorization_items"("id", "codigo_medicamento") ON DELETE RESTRICT,
  CONSTRAINT "patient_applications_schedule_revision_check" CHECK ("schedule_revision" > 0),
  CONSTRAINT "patient_applications_version_check" CHECK ("version" > 0),
  CONSTRAINT "patient_applications_status_check" CHECK ("status" IN ('DRAFT','CONFIRMED','CANCELLED'))
);
CREATE UNIQUE INDEX "patient_applications_active_schedule_idx"
  ON "patient_applications" ("patient_schedule_id")
  WHERE "status" IN ('DRAFT', 'CONFIRMED');
CREATE INDEX "patient_applications_status_created_idx"
  ON "patient_applications" ("status", "created_at");

CREATE TABLE "patient_application_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_application_id" uuid NOT NULL REFERENCES "patient_applications"("id") ON DELETE RESTRICT,
  "inventory_lot_id" uuid NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "lot_number" varchar(255) NOT NULL,
  "expiration_date" date NOT NULL,
  "quantity" integer NOT NULL,
  "fefo_override" boolean DEFAULT false NOT NULL,
  "fefo_override_reason" varchar(500),
  CONSTRAINT "patient_application_lines_lot_unique" UNIQUE ("patient_application_id", "inventory_lot_id"),
  CONSTRAINT "patient_application_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "patient_application_lines_override_check"
    CHECK ("fefo_override" = false OR length(btrim("fefo_override_reason")) > 0)
);
CREATE INDEX "patient_application_lines_application_idx"
  ON "patient_application_lines" ("patient_application_id");

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_application_delta_check"
  CHECK ("movement_type" <> 'APPLICATION' OR "quantity_delta" < 0);

CREATE OR REPLACE FUNCTION enforce_application_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.movement_type = 'APPLICATION' THEN
    IF NEW.source_type <> 'APPLICATION_LINE' OR NEW.quantity_delta >= 0 THEN
      RAISE EXCEPTION 'APPLICATION movement must be a negative APPLICATION_LINE movement';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM patient_application_lines WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'APPLICATION movement requires an application line';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_movements_application_guard
  BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION enforce_application_movement();

CREATE OR REPLACE FUNCTION prevent_confirmed_application_mutation_app() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'CONFIRMED application is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'CONFIRMED application is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION prevent_confirmed_application_mutation_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM patient_applications WHERE id = COALESCE(NEW.patient_application_id, OLD.patient_application_id) AND status = 'CONFIRMED'
  ) THEN
    RAISE EXCEPTION 'CONFIRMED application lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patient_applications_confirmed_immutable
  BEFORE UPDATE OR DELETE ON patient_applications
  FOR EACH ROW EXECUTE FUNCTION prevent_confirmed_application_mutation_app();
CREATE TRIGGER patient_application_lines_confirmed_immutable
  BEFORE UPDATE OR DELETE ON patient_application_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_confirmed_application_mutation_line();

CREATE OR REPLACE FUNCTION validate_confirmed_application_quantity(application_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  target_application_id uuid;
  expected integer;
  actual integer;
BEGIN
  target_application_id := application_id;
  SELECT ps.quantity INTO expected
    FROM patient_applications pa JOIN patient_schedules ps ON ps.id = pa.patient_schedule_id
   WHERE pa.id = target_application_id AND pa.status = 'CONFIRMED';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(sum(quantity), 0)::integer INTO actual
    FROM patient_application_lines WHERE patient_application_id = target_application_id;
  IF actual <> expected THEN
    RAISE EXCEPTION 'CONFIRMED application quantity must equal scheduled quantity';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION enforce_confirmed_application_quantity_app() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_confirmed_application_quantity(NEW.id);
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION enforce_confirmed_application_quantity_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_confirmed_application_quantity(NEW.patient_application_id);
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER patient_applications_quantity_guard
  AFTER INSERT OR UPDATE ON patient_applications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_application_quantity_app();
CREATE CONSTRAINT TRIGGER patient_application_lines_quantity_guard
  AFTER INSERT OR UPDATE ON patient_application_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_application_quantity_line();

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'patient_applications.read', 'Read patient applications'),
  (gen_random_uuid(), 'patient_applications.manage', 'Manage patient applications')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN','MTD_OPERATOR','MTD_GENERAL','MTD_AUDITORIA','READ_ONLY','MEDICARTE_OPERATOR')
  AND p.code = 'patient_applications.read'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'MEDICARTE_OPERATOR' AND p.code = 'patient_applications.manage'
ON CONFLICT DO NOTHING;
