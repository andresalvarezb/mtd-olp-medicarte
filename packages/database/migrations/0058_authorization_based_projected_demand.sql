-- La demanda proyectada nace del cargue de autorizaciones, no de la
-- programación de pacientes. Las columnas de programación se conservan para
-- consultar el histórico ya consolidado.
ALTER TABLE "demand_sources"
  ALTER COLUMN "patient_schedule_id" DROP NOT NULL,
  ALTER COLUMN "schedule_revision" DROP NOT NULL,
  ADD COLUMN "authorization_item_id" uuid,
  ADD COLUMN "loaded_at" timestamptz;

ALTER TABLE "demand_sources"
  DROP CONSTRAINT "demand_sources_schedule_revision_fk",
  ADD CONSTRAINT "demand_sources_authorization_item_fk"
    FOREIGN KEY ("authorization_item_id") REFERENCES "authorization_items" ("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "demand_sources_authorization_or_schedule_check"
    CHECK ("authorization_item_id" IS NOT NULL OR ("patient_schedule_id" IS NOT NULL AND "schedule_revision" IS NOT NULL));

CREATE UNIQUE INDEX "demand_sources_authorization_item_unique"
  ON "demand_sources" ("projected_demand_line_id", "authorization_item_id")
  WHERE "authorization_item_id" IS NOT NULL;

COMMENT ON TABLE "demand_sources" IS
  'Lineage de demanda. Las fuentes nuevas son autorizaciones cargadas; las fuentes de programación son históricas.';
