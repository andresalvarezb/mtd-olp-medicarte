/*
 * Auditoría de facturación de AUTOs.
 *
 * Dominio independiente de audit_reviews / application audits.
 *
 * Invariantes:
 * - 1 AUTO -> 0..1 auditoría de facturación.
 * - PENDING no tiene resultado ni auditoría final.
 * - REVIEWED exige resultado, auditor y fecha.
 * - DOES_NOT_COMPLY exige observación.
 * - una decisión REVIEWED es terminal.
 * - los soportes se almacenan únicamente como metadatos de Google Drive.
 */

CREATE TABLE "authorization_billing_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "authorization_item_id" uuid NOT NULL
    REFERENCES "authorization_items"("id")
    ON DELETE RESTRICT,

  "status" varchar(20) NOT NULL DEFAULT 'PENDING',

  "result" varchar(30),

  "observation" text,

  "created_by" uuid NOT NULL
    REFERENCES "users"("id")
    ON DELETE RESTRICT,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  "audited_by" uuid
    REFERENCES "users"("id")
    ON DELETE RESTRICT,

  "audited_at" timestamptz,

  "correlation_id" uuid NOT NULL,

  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "authorization_billing_audits_status_check"
    CHECK (
      "status" IN ('PENDING', 'REVIEWED')
    ),

  CONSTRAINT "authorization_billing_audits_result_check"
    CHECK (
      "result" IS NULL
      OR "result" IN ('COMPLIES', 'DOES_NOT_COMPLY')
    ),

  CONSTRAINT "authorization_billing_audits_state_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "result" IS NULL
        AND "audited_by" IS NULL
        AND "audited_at" IS NULL
      )
      OR
      (
        "status" = 'REVIEWED'
        AND "result" IS NOT NULL
        AND "audited_by" IS NOT NULL
        AND "audited_at" IS NOT NULL
      )
    ),

  CONSTRAINT "authorization_billing_audits_non_compliance_observation_check"
    CHECK (
      "result" IS DISTINCT FROM 'DOES_NOT_COMPLY'
      OR (
        "observation" IS NOT NULL
        AND length(btrim("observation")) > 0
      )
    )
);

CREATE UNIQUE INDEX
  "authorization_billing_audits_authorization_unique"
ON
  "authorization_billing_audits" ("authorization_item_id");

CREATE INDEX
  "authorization_billing_audits_status_created_idx"
ON
  "authorization_billing_audits" (
    "status",
    "created_at",
    "id"
  );


CREATE TABLE "authorization_billing_audit_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "billing_audit_id" uuid NOT NULL
    REFERENCES "authorization_billing_audits"("id")
    ON DELETE RESTRICT,

  "drive_file_id" varchar(255) NOT NULL,

  "file_name" text NOT NULL,

  "mime_type" varchar(255),

  "web_view_link" text,

  "size_bytes" numeric(20, 0),

  "md5_checksum" varchar(64),

  "drive_modified_at" timestamptz,

  "discovered_at" timestamptz NOT NULL DEFAULT now(),

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "authorization_billing_audit_evidence_drive_file_not_blank_check"
    CHECK (
      length(btrim("drive_file_id")) > 0
    ),

  CONSTRAINT "authorization_billing_audit_evidence_file_name_not_blank_check"
    CHECK (
      length(btrim("file_name")) > 0
    ),

  CONSTRAINT "authorization_billing_audit_evidence_size_check"
    CHECK (
      "size_bytes" IS NULL
      OR "size_bytes" >= 0
    )
);

CREATE UNIQUE INDEX
  "authorization_billing_audit_evidence_audit_drive_unique"
ON
  "authorization_billing_audit_evidence" (
    "billing_audit_id",
    "drive_file_id"
  );

CREATE INDEX
  "authorization_billing_audit_evidence_audit_idx"
ON
  "authorization_billing_audit_evidence" (
    "billing_audit_id",
    "discovered_at",
    "id"
  );


/*
 * La auditoría REVIEWED es terminal.
 * Tampoco permitimos DELETE porque la decisión debe conservar trazabilidad.
 */
CREATE OR REPLACE FUNCTION
  prevent_terminal_authorization_billing_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Authorization billing audit cannot be deleted';
  END IF;

  IF OLD.status = 'REVIEWED'
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION
      'Reviewed authorization billing audit is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER
  authorization_billing_audits_terminal_immutable
BEFORE UPDATE OR DELETE
ON authorization_billing_audits
FOR EACH ROW
EXECUTE FUNCTION
  prevent_terminal_authorization_billing_audit_mutation();
