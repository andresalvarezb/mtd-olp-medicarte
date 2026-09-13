-- ESP-004: consolidación de demanda proyectada.
-- Migración aditiva sobre ESP-003. La demanda consolidada NO es editable
-- manualmente: se reconstruye idempotentemente desde patient_schedules
-- vigentes (SCHEDULED/RESCHEDULED) mediante consolidatePeriod.
--
-- Decisiones (ver ADR-031):
-- * La identidad de consolidación es
--   planning_period_id + dispensing_point_id + commercial_code y ahora es un
--   UNIQUE CONSTRAINT (reemplaza al índice único de ESP-001) para poder
--   referenciarla con FK.
-- * La split de cantidades regular/late expresa el origen del volumen:
--   projected_quantity = regular_quantity + late_quantity (CHECK).
-- * demand_sources percibe membership por (periodo, punto, código) de su
--   línea con FK compuesto: una fuente no puede apuntar a una línea de otro
--   período/punto/código. La sumatoria agregada se verifica en la
--   transacción de consolidación, NO con triggers de suma.
-- * Las fuentes llevan snapshot de cantidad y timing (`schedule_timing`),
--   pinneadas además por la revision del historial (FK compuesto ya
--   existente); re-consolidar reemplaza las fuentes desactualizadas, nunca
--   acumula sobre las cantidades anteriores.

ALTER TABLE "projected_demand_lines"
  ADD COLUMN "regular_quantity" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "late_quantity" integer DEFAULT 0 NOT NULL;

UPDATE "projected_demand_lines"
   SET "regular_quantity" = "projected_quantity"
 WHERE "regular_quantity" = 0 AND "late_quantity" = 0;

ALTER TABLE "projected_demand_lines"
  DROP CONSTRAINT "projected_demand_lines_quantity_check";

ALTER TABLE "projected_demand_lines"
  ADD CONSTRAINT "projected_demand_lines_quantity_check"
    CHECK ("projected_quantity" > 0),
  ADD CONSTRAINT "projected_demand_lines_split_check"
    CHECK ("projected_quantity" = "regular_quantity" + "late_quantity"),
  ADD CONSTRAINT "projected_demand_lines_split_nonnegative_check"
    CHECK ("regular_quantity" >= 0 AND "late_quantity" >= 0);

-- La identidad de consolidación se convierte en UNIQUE CONSTRAINT para poder
-- referenciarla desde demand_sources con FK compuesto. Renombra la constraint
-- exclusiva creada en 0031 (misma definición, nombre canónico de ESP-004).
ALTER TABLE "projected_demand_lines"
  RENAME CONSTRAINT "projected_demand_lines_period_point_code_unique"
  TO "projected_demand_lines_identity_unique";

ALTER TABLE "demand_sources"
  ADD COLUMN "planning_period_id" uuid,
  ADD COLUMN "dispensing_point_id" uuid,
  ADD COLUMN "commercial_code" varchar(255),
  ADD COLUMN "schedule_timing" varchar(10),
  ADD COLUMN "late_handling" varchar(40),
  ADD COLUMN "demand_bucket" varchar(30);

UPDATE "demand_sources" ds
   SET "planning_period_id" = pdl."planning_period_id",
       "dispensing_point_id" = pdl."dispensing_point_id",
       "commercial_code" = pdl."commercial_code",
       "schedule_timing" = 'ON_TIME',
       "late_handling" = NULL,
       "demand_bucket" = 'REGULAR'
  FROM "projected_demand_lines" pdl
 WHERE ds."projected_demand_line_id" = pdl."id";

ALTER TABLE "demand_sources"
  ALTER COLUMN "planning_period_id" SET NOT NULL,
  ALTER COLUMN "dispensing_point_id" SET NOT NULL,
  ALTER COLUMN "commercial_code" SET NOT NULL,
  ALTER COLUMN "schedule_timing" SET NOT NULL,
  ALTER COLUMN "demand_bucket" SET NOT NULL;

ALTER TABLE "demand_sources"
  ADD CONSTRAINT "demand_sources_schedule_timing_check"
    CHECK ("schedule_timing" IN ('ON_TIME', 'LATE')),
  ADD CONSTRAINT "demand_sources_late_handling_check"
    CHECK ("late_handling" IS NULL OR "late_handling" IN ('COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD')),
  ADD CONSTRAINT "demand_sources_demand_bucket_check"
    CHECK ("demand_bucket" IN ('REGULAR', 'LATE')),
  ADD CONSTRAINT "demand_sources_line_identity_fk"
    FOREIGN KEY ("planning_period_id", "dispensing_point_id", "commercial_code")
    REFERENCES "projected_demand_lines" ("planning_period_id", "dispensing_point_id", "commercial_code")
    ON DELETE RESTRICT;

-- RBAC del módulo de demanda (matriz inicial en ADR-031).
INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'projected_demand.read', 'Read projected demand lines and their sources'),
  (gen_random_uuid(), 'projected_demand.manage', 'Consolidate projected demand for a period')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY')
  AND p."code" = 'projected_demand.read'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR')
  AND p."code" = 'projected_demand.manage'
ON CONFLICT DO NOTHING;
