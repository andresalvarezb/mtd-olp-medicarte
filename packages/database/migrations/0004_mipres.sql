-- Fase 3 (DEC-013/SPEC-003): evidencia historica de consultas MIPRES y
-- direccionamientos normalizados. Cada intento crea un check; no se
-- sobrescriben respuestas historicas y los tokens se redactan antes de
-- persistir cualquier evidencia. `check_date` es la fecha calendario
-- America/Bogota de la consulta y habilita el limite diario de rechecks
-- manuales y la deduplicacion de la revalidacion automatica.

CREATE TABLE "mipres_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_item_id" uuid NOT NULL REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "prescription_number" varchar(255) NOT NULL,
  "query_type" varchar(10) NOT NULL CHECK ("query_type" IN ('AUTO', 'MANUAL')),
  "outcome" varchar(20) NOT NULL CHECK ("outcome" IN ('PENDING', 'CONFIRMED', 'QUERY_ERROR')),
  "http_status" integer,
  "direction_count" integer NOT NULL DEFAULT 0 CHECK ("direction_count" >= 0),
  "has_current_direction" boolean,
  "rule_version" varchar(40) NOT NULL,
  "check_date" date NOT NULL,
  "response_payload" jsonb,
  "correlation_id" uuid NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "queried_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "mipres_checks_item_idx" ON "mipres_checks" ("authorization_item_id", "queried_at");
CREATE INDEX "mipres_checks_item_day_idx" ON "mipres_checks" ("authorization_item_id", "query_type", "check_date");

CREATE TABLE "mipres_directions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mipres_check_id" uuid NOT NULL REFERENCES "mipres_checks"("id") ON DELETE RESTRICT,
  "authorization_item_id" uuid NOT NULL REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "external_id" varchar(120) NOT NULL,
  "direction_id" varchar(120) NOT NULL,
  "prescription_number" varchar(255) NOT NULL,
  "technology_type" varchar(40) NOT NULL,
  "technology_consecutive" varchar(40) NOT NULL,
  "maximum_delivery_date" date NOT NULL,
  "external_status" varchar(80) NOT NULL,
  "annulled" boolean NOT NULL,
  "current" boolean NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "mipres_directions_check_idx" ON "mipres_directions" ("mipres_check_id");
CREATE INDEX "mipres_directions_item_idx" ON "mipres_directions" ("authorization_item_id", "created_at");
