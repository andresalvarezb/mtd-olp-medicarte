-- ESP-012: MTD audits confirmed patient applications without changing the physical fact.
ALTER TABLE "authorization_items"
  DROP CONSTRAINT IF EXISTS "authorization_items_approval_requires_dispensed_check";

CREATE TABLE "patient_application_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_application_id" uuid NOT NULL REFERENCES "patient_applications"("id") ON DELETE RESTRICT,
  "application_revision" integer NOT NULL,
  "authorization_item_id" uuid NOT NULL REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "status" varchar(20) NOT NULL DEFAULT 'IN_REVIEW',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "started_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_at" timestamptz,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "rejection_code" varchar(40),
  "observation" varchar(1000),
  "evidence_reference" varchar(1000),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "patient_application_audits_revision_check" CHECK ("application_revision" > 0),
  CONSTRAINT "patient_application_audits_status_check" CHECK ("status" IN ('IN_REVIEW','APPROVED','REJECTED')),
  CONSTRAINT "patient_application_audits_version_check" CHECK ("version" > 0),
  CONSTRAINT "patient_application_audits_decision_fields_check" CHECK (
    "status" = 'IN_REVIEW' OR ("decided_at" IS NOT NULL AND "decided_by" IS NOT NULL)
  ),
  CONSTRAINT "patient_application_audits_rejection_code_check" CHECK (
    "status" <> 'REJECTED' OR "rejection_code" IS NOT NULL
  ),
  CONSTRAINT "patient_application_audits_other_observation_check" CHECK (
    "rejection_code" <> 'OTHER' OR ("observation" IS NOT NULL AND length(btrim("observation")) > 0)
  ),
  CONSTRAINT "patient_application_audits_non_rejection_fields_check" CHECK (
    "status" = 'REJECTED' OR ("rejection_code" IS NULL AND "observation" IS NULL)
  )
);
CREATE UNIQUE INDEX "patient_application_audits_application_unique"
  ON "patient_application_audits" ("patient_application_id");
CREATE INDEX "patient_application_audits_status_date_idx"
  ON "patient_application_audits" ("status", "started_at", "id");
CREATE INDEX "patient_application_audits_authorization_idx"
  ON "patient_application_audits" ("authorization_item_id", "status");

CREATE OR REPLACE FUNCTION prevent_terminal_patient_application_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Patient application audit is immutable';
  END IF;
  IF OLD.status IN ('APPROVED', 'REJECTED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal patient application audit is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patient_application_audits_terminal_immutable
  BEFORE UPDATE OR DELETE ON patient_application_audits
  FOR EACH ROW EXECUTE FUNCTION prevent_terminal_patient_application_audit_mutation();

CREATE OR REPLACE FUNCTION validate_approved_application_audit_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND NOT EXISTS (
    SELECT 1
    FROM patient_applications pa
    JOIN authorization_items ai ON ai.id = pa.authorization_item_id
    WHERE pa.id = NEW.patient_application_id
      AND pa.authorization_item_id = NEW.authorization_item_id
      AND pa.status = 'CONFIRMED'
      AND ai.id = NEW.authorization_item_id
      AND ai.admission_status = 'READY'
  ) THEN
    RAISE EXCEPTION 'Approved application audit requires confirmed application and READY admission';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION validate_ready_admission_has_application_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.admission_status = 'READY'
     AND (TG_OP = 'INSERT' OR OLD.admission_status IS DISTINCT FROM NEW.admission_status) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM patient_application_audits paa
      JOIN patient_applications pa ON pa.id = paa.patient_application_id
      WHERE paa.authorization_item_id = NEW.id
        AND paa.status = 'APPROVED'
        AND pa.status = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'READY admission requires an approved patient application audit';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER patient_application_audits_admission_link_guard
  AFTER INSERT OR UPDATE ON patient_application_audits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_approved_application_audit_admission();
CREATE CONSTRAINT TRIGGER authorization_items_application_audit_admission_guard
  AFTER INSERT OR UPDATE ON authorization_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_ready_admission_has_application_audit();

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'application_audits.read', 'Read patient application audits'),
  (gen_random_uuid(), 'application_audits.manage', 'Manage patient application audits')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN','MTD_AUDITORIA','MTD_OPERATOR','MTD_GENERAL','READ_ONLY')
  AND p.code = 'application_audits.read'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN','MTD_AUDITORIA')
  AND p.code = 'application_audits.manage'
ON CONFLICT DO NOTHING;
