-- ADR-027: cada intento de un registro rechazado es trazable sin sobrescribir
-- la novedad histórica. El valor se calcula al insertar una novedad nueva.
ALTER TABLE "novelties"
  ADD COLUMN IF NOT EXISTS "attempt_number" integer NOT NULL DEFAULT 1;

ALTER TABLE "novelties"
  DROP CONSTRAINT IF EXISTS "novelties_attempt_number_check";
ALTER TABLE "novelties"
  ADD CONSTRAINT "novelties_attempt_number_check" CHECK ("attempt_number" > 0);

CREATE INDEX IF NOT EXISTS "novelties_attempt_idx"
  ON "novelties" ("code", "authorization_item_id", "attempt_number");
