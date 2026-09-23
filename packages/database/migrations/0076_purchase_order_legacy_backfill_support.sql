-- Historical purchase-order reconstruction support.
--
-- Operational purchase orders keep all existing invariants.
-- LEGACY_BACKFILL rows are explicitly separated and are allowed to omit
-- facts that cannot be proven from the historical source.

ALTER TABLE "purchase_orders"
  ADD COLUMN "origin" varchar(30) DEFAULT 'OPERATIONAL' NOT NULL,
  ADD COLUMN "legacy_assigned_at" timestamptz,
  ADD COLUMN "legacy_assigned_by" uuid;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_legacy_assigned_by_fk"
  FOREIGN KEY ("legacy_assigned_by")
  REFERENCES "users" ("id")
  ON DELETE RESTRICT;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "planning_period_id" DROP NOT NULL,
  ALTER COLUMN "order_type" DROP NOT NULL;

ALTER TABLE "purchase_orders"
  DROP CONSTRAINT IF EXISTS "purchase_orders_type_check",
  DROP CONSTRAINT IF EXISTS "purchase_orders_status_check";

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_origin_check"
    CHECK ("origin" IN ('OPERATIONAL', 'LEGACY_BACKFILL')),

  ADD CONSTRAINT "purchase_orders_type_check"
    CHECK (
      "order_type" IS NULL
      OR "order_type" IN ('STANDARD', 'COMPLEMENTARY')
    ),

  ADD CONSTRAINT "purchase_orders_status_check"
    CHECK (
      "status" IN (
        'DRAFT',
        'ISSUED',
        'UNDER_OLP_REVIEW',
        'ACCEPTED',
        'PARTIALLY_ACCEPTED',
        'REJECTED',
        'CANCELLED',
        'IN_FULFILLMENT',
        'PARTIALLY_DISPATCHED',
        'FULLY_DISPATCHED',
        'PARTIALLY_RECEIVED',
        'RECEIVED',
        'HISTORICAL_ONLY'
      )
    ),

  ADD CONSTRAINT "purchase_orders_origin_shape_check"
    CHECK (
      (
        "origin" = 'OPERATIONAL'
        AND "planning_period_id" IS NOT NULL
        AND "order_type" IS NOT NULL
        AND "status" <> 'HISTORICAL_ONLY'
        AND "legacy_assigned_at" IS NULL
        AND "legacy_assigned_by" IS NULL
      )
      OR
      (
        "origin" = 'LEGACY_BACKFILL'
        AND "planning_period_id" IS NULL
        AND "order_type" IS NULL
        AND "status" = 'HISTORICAL_ONLY'
        AND "legacy_assigned_at" IS NOT NULL
        AND "legacy_assigned_by" IS NOT NULL
      )
    );

CREATE INDEX "purchase_orders_origin_idx"
  ON "purchase_orders" ("origin", "created_at");


ALTER TABLE "purchase_order_lines"
  ADD COLUMN "provenance" varchar(40)
    DEFAULT 'LIVE_DEMAND' NOT NULL,

  ADD COLUMN "tariff_snapshot_provenance" varchar(40)
    DEFAULT 'LIVE_SNAPSHOT' NOT NULL,

  ADD COLUMN "legacy_tariff_revision_id" uuid;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_legacy_tariff_revision_fk"
  FOREIGN KEY ("legacy_tariff_revision_id")
  REFERENCES "tariff_product_revisions" ("id")
  ON DELETE RESTRICT;

ALTER TABLE "purchase_order_lines"
  ALTER COLUMN "compensar_unit_rate_snapshot" DROP NOT NULL,
  ALTER COLUMN "projected_demand_line_id" DROP NOT NULL,
  ALTER COLUMN "projected_demand_revision" DROP NOT NULL,
  ALTER COLUMN "demand_bucket" DROP NOT NULL;

ALTER TABLE "purchase_order_lines"
  DROP CONSTRAINT IF EXISTS "purchase_order_lines_revision_check",
  DROP CONSTRAINT IF EXISTS "purchase_order_lines_bucket_check";

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_provenance_check"
    CHECK (
      "provenance" IN (
        'LIVE_DEMAND',
        'LEGACY_AUTHORIZATION'
      )
    ),

  ADD CONSTRAINT "purchase_order_lines_tariff_provenance_check"
    CHECK (
      "tariff_snapshot_provenance" IN (
        'LIVE_SNAPSHOT',
        'LEGACY_DERIVED_REVISION',
        'LEGACY_REVISION_NO_RATE',
        'LEGACY_UNRESOLVED'
      )
    ),

  ADD CONSTRAINT "purchase_order_lines_origin_shape_check"
    CHECK (
      (
        "provenance" = 'LIVE_DEMAND'
        AND "projected_demand_line_id" IS NOT NULL
        AND "projected_demand_revision" IS NOT NULL
        AND "projected_demand_revision" > 0
        AND "demand_bucket" IN ('REGULAR', 'LATE')
        AND "compensar_unit_rate_snapshot" IS NOT NULL
        AND "tariff_snapshot_provenance" = 'LIVE_SNAPSHOT'
        AND "legacy_tariff_revision_id" IS NULL
      )
      OR
      (
        "provenance" = 'LEGACY_AUTHORIZATION'
        AND "projected_demand_line_id" IS NULL
        AND "projected_demand_revision" IS NULL
        AND "demand_bucket" IS NULL
        AND (
          (
            "tariff_snapshot_provenance" = 'LEGACY_DERIVED_REVISION'
            AND "compensar_unit_rate_snapshot" IS NOT NULL
            AND "legacy_tariff_revision_id" IS NOT NULL
          )
          OR
          (
            "tariff_snapshot_provenance" = 'LEGACY_REVISION_NO_RATE'
            AND "compensar_unit_rate_snapshot" IS NULL
            AND "legacy_tariff_revision_id" IS NOT NULL
          )
          OR
          (
            "tariff_snapshot_provenance" = 'LEGACY_UNRESOLVED'
            AND "compensar_unit_rate_snapshot" IS NULL
            AND "legacy_tariff_revision_id" IS NULL
          )
        )
      )
    );


ALTER TABLE "purchase_order_authorization_sources"
  ADD COLUMN "provenance" varchar(40)
    DEFAULT 'LIVE_DEMAND' NOT NULL,

  ADD COLUMN "evidence_at" timestamptz;

ALTER TABLE "purchase_order_authorization_sources"
  ALTER COLUMN "projected_demand_line_id" DROP NOT NULL,
  ALTER COLUMN "projected_demand_revision" DROP NOT NULL;

ALTER TABLE "purchase_order_authorization_sources"
  DROP CONSTRAINT IF EXISTS
    "purchase_order_authorization_sources_revision_check";

ALTER TABLE "purchase_order_authorization_sources"
  ADD CONSTRAINT "purchase_order_authorization_sources_provenance_check"
    CHECK (
      "provenance" IN (
        'LIVE_DEMAND',
        'LEGACY_DIRECT_ASSIGNMENT',
        'LEGACY_CURRENT_STATE'
      )
    ),

  ADD CONSTRAINT "purchase_order_authorization_sources_origin_shape_check"
    CHECK (
      (
        "provenance" = 'LIVE_DEMAND'
        AND "projected_demand_line_id" IS NOT NULL
        AND "projected_demand_revision" IS NOT NULL
        AND "projected_demand_revision" > 0
        AND "evidence_at" IS NULL
      )
      OR
      (
        "provenance" = 'LEGACY_DIRECT_ASSIGNMENT'
        AND "projected_demand_line_id" IS NULL
        AND "projected_demand_revision" IS NULL
        AND "evidence_at" IS NOT NULL
      )
      OR
      (
        "provenance" = 'LEGACY_CURRENT_STATE'
        AND "projected_demand_line_id" IS NULL
        AND "projected_demand_revision" IS NULL
        AND "evidence_at" IS NULL
      )
    );

COMMENT ON COLUMN "purchase_orders"."origin" IS
  'OPERATIONAL for native purchase orders; LEGACY_BACKFILL for reconstructed historical purchase orders.';

COMMENT ON COLUMN "purchase_order_lines"."provenance" IS
  'Identifies whether the line comes from live projected demand or historical authorization evidence.';

COMMENT ON COLUMN "purchase_order_authorization_sources"."provenance" IS
  'Evidence source for immutable authorization provenance.';
