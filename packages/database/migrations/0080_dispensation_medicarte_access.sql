-- DISPENSACION MODERNA
--
-- fecha_dispensacion en authorization_items es HISTORICAL_ONLY.
-- El runtime moderno persiste el evento en authorization_dispensations.
--
-- Esta migración también transfiere la capacidad de reporte de
-- dispensación desde OLP hacia MEDICARTE.

CREATE TABLE "authorization_dispensations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT,

  "authorization_item_id" uuid NOT NULL
    REFERENCES "authorization_items"("id")
    ON DELETE RESTRICT,

  "dispensation_date" date NOT NULL,

  "source" varchar(10) NOT NULL DEFAULT 'XLSX',

  "reported_by" uuid NOT NULL
    REFERENCES "users"("id")
    ON DELETE RESTRICT,

  "reported_at" timestamptz NOT NULL DEFAULT now(),

  "created_at" timestamptz NOT NULL DEFAULT now(),

  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "authorization_dispensations_authorization_unique"
    UNIQUE ("authorization_item_id"),

  CONSTRAINT "authorization_dispensations_source_check"
    CHECK ("source" IN ('UI', 'XLSX'))
);

CREATE INDEX "authorization_dispensations_org_date_idx"
  ON "authorization_dispensations" (
    "organization_id",
    "dispensation_date",
    "authorization_item_id"
  );

CREATE INDEX "authorization_dispensations_authorization_idx"
  ON "authorization_dispensations" (
    "authorization_item_id"
  );


-- OLP deja de reportar dispensación.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'OLP_OPERATOR'
  AND p.code = 'bulk_updates.dispensation_date';


-- MEDICARTE obtiene la capacidad.
INSERT INTO role_permissions (
  role_id,
  permission_id
)
SELECT
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'MEDICARTE_OPERATOR'
  AND p.code = 'bulk_updates.dispensation_date'
ON CONFLICT DO NOTHING;
