-- RF-PAC-001 Etapa 1A: maestro local mínimo y vínculo opcional.
-- Los valores se conservan tal como llegan; no se define normalización,
-- unicidad documental ni se copian datos de autorizaciones existentes.
CREATE TABLE "patients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identification_type_raw" varchar(80) NOT NULL,
  "identification_value_raw" varchar(255) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "patients_identification_type_not_blank_check"
    CHECK (length(btrim("identification_type_raw")) > 0),
  CONSTRAINT "patients_identification_value_not_blank_check"
    CHECK (length(btrim("identification_value_raw")) > 0)
);

ALTER TABLE "authorization_items"
  ADD COLUMN "patient_id" uuid,
  ADD CONSTRAINT "authorization_items_patient_id_patients_id_fk"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT;

CREATE INDEX "authorization_items_patient_id_idx"
  ON "authorization_items" ("patient_id");
