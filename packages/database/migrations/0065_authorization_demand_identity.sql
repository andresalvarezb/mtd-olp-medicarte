-- Macro 3A:
-- - la demanda viva nace de authorization_items;
-- - no depende de punto MEDICARTE;
-- - las líneas históricas por punto se conservan;
-- - una línea viva (dispensing_point_id IS NULL) es única por
--   planning_period_id + commercial_code.

CREATE UNIQUE INDEX "projected_demand_lines_live_period_code_unique"
  ON "projected_demand_lines" ("planning_period_id", "commercial_code")
  WHERE "dispensing_point_id" IS NULL;

-- Clave candidata estable para validar la identidad de cada demand_source
-- sin incluir dispensing_point_id.
ALTER TABLE "projected_demand_lines"
  ADD CONSTRAINT "projected_demand_lines_source_identity_unique"
  UNIQUE ("id", "planning_period_id", "commercial_code");

-- La FK histórica incluía dispensing_point_id. Para las fuentes nuevas ese
-- valor es NULL y PostgreSQL MATCH SIMPLE omitía la comprobación compuesta.
-- Se reemplaza por line_id + período + código.
ALTER TABLE "demand_sources"
  DROP CONSTRAINT "demand_sources_line_identity_fk",
  ADD CONSTRAINT "demand_sources_line_identity_fk"
    FOREIGN KEY (
      "projected_demand_line_id",
      "planning_period_id",
      "commercial_code"
    )
    REFERENCES "projected_demand_lines" (
      "id",
      "planning_period_id",
      "commercial_code"
    )
    ON DELETE RESTRICT;
