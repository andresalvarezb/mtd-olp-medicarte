-- AUTO identity originates with COMPENSAR. This is deliberately nullable for
-- the additive rollout: existing historical rows are not inferred or rewritten
-- by a schema migration.
ALTER TABLE "patients"
  ADD COLUMN "source_organization_id" uuid
    REFERENCES "organizations"("id") ON DELETE RESTRICT;

CREATE INDEX "patients_source_identity_raw_idx"
  ON "patients" ("source_organization_id", "identification_type_raw", "identification_value_raw");
