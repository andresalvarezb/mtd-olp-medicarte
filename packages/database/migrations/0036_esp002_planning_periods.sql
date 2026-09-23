-- ESP-002: períodos de planificación con comportamiento operativo.
-- Migración aditiva sobre la base creada por ESP-001 (0031).
--
-- Decisiones:
-- * El scope de los períodos es global: existe un único calendario operativo
--   compartido por MTD, OLP y Medicarte. Por eso el anti-solapamiento es una
--   constraint de rango sin partición por organización (ver ADR-029).
-- * `daterange(..., '[]')` es inclusivo; dos períodos contiguos (fin+1 día)
--   no se consideran solapados.
-- * Drizzle no expone EXCLUDE USING gist en el esquema; la invariante vive
--   exclusivamente en PostgreSQL.

ALTER TABLE "planning_periods"
  RENAME COLUMN "programming_deadline_at" TO "scheduling_cutoff_at";

ALTER TABLE "planning_periods"
  ADD COLUMN "updated_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT;
UPDATE "planning_periods" SET "updated_by" = "created_by" WHERE "updated_by" IS NULL;
ALTER TABLE "planning_periods" ALTER COLUMN "updated_by" SET NOT NULL;

ALTER TABLE "planning_periods"
  ADD COLUMN "version" integer DEFAULT 1 NOT NULL;

ALTER TABLE "planning_periods"
  ADD CONSTRAINT "planning_periods_delivery_after_purchase_check"
  CHECK ((timezone('America/Bogota', "purchase_order_deadline_at"))::date <= "expected_delivery_date");

ALTER TABLE "planning_periods"
  ADD CONSTRAINT "planning_periods_version_check" CHECK ("version" > 0);

ALTER TABLE "planning_periods"
  ADD CONSTRAINT "planning_periods_no_overlap"
  EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);

-- Las fechas del rango solo son editables en OPEN y PLANNING_CLOSED.
-- A partir de PURCHASING quedan congeladas; la API valida lo mismo antes de
-- escribir y este trigger actúa como red de seguridad transaccional.
CREATE OR REPLACE FUNCTION prevent_planning_period_structural_change() RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('OPEN', 'PLANNING_CLOSED')
     AND (NEW."start_date" <> OLD."start_date" OR NEW."end_date" <> OLD."end_date") THEN
    RAISE EXCEPTION 'planning_periods range dates are frozen after planning';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER planning_periods_freeze_structural_dates
  BEFORE UPDATE ON "planning_periods"
  FOR EACH ROW EXECUTE FUNCTION prevent_planning_period_structural_change();

-- RBAC: se reutiliza el modelo actual (usuarios + organización + rol +
-- permisos). Solo se añaden permisos del módulo; no se rediseña el alcance
-- por organización/punto (eso corresponde a ESP-015).
INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'planning_periods.read', 'Read planning periods'),
  (gen_random_uuid(), 'planning_periods.manage', 'Create, edit and transition planning periods')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY')
  AND p."code" = 'planning_periods.read'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR')
  AND p."code" = 'planning_periods.manage'
ON CONFLICT DO NOTHING;
