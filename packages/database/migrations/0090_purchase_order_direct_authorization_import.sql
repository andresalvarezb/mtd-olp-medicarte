-- OC universal desde autorización.
--
-- La plantilla de OC puede:
--   1. crear una OC desde AUTO_DESTINO;
--   2. agregar AUTO_DESTINO a una OC existente;
--   3. reasignar AUTO_ORIGEN -> AUTO_DESTINO.
--
-- La demanda proyectada NO es requisito para los dos
-- primeros casos.

ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS
    purchase_orders_origin_check;

ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS
    purchase_orders_origin_shape_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT
    purchase_orders_origin_check
  CHECK (
    origin IN (
      'OPERATIONAL',
      'LEGACY_BACKFILL',
      'DIRECT_AUTHORIZATION'
    )
  );

ALTER TABLE purchase_orders
  ADD CONSTRAINT
    purchase_orders_origin_shape_check
  CHECK (
    (
      origin = 'OPERATIONAL'
      AND planning_period_id IS NOT NULL
      AND order_type IS NOT NULL
      AND status <> 'HISTORICAL_ONLY'
      AND legacy_assigned_at IS NULL
      AND legacy_assigned_by IS NULL
    )
    OR
    (
      origin = 'LEGACY_BACKFILL'
      AND planning_period_id IS NULL
      AND order_type IS NULL
      AND status = 'HISTORICAL_ONLY'
      AND legacy_assigned_at IS NOT NULL
      AND legacy_assigned_by IS NOT NULL
    )
    OR
    (
      origin = 'DIRECT_AUTHORIZATION'
      AND planning_period_id IS NULL
      AND order_type = 'STANDARD'
      AND status <> 'HISTORICAL_ONLY'
      AND legacy_assigned_at IS NULL
      AND legacy_assigned_by IS NULL
    )
  );


ALTER TABLE purchase_order_lines
  DROP CONSTRAINT IF EXISTS
    purchase_order_lines_provenance_check;

ALTER TABLE purchase_order_lines
  DROP CONSTRAINT IF EXISTS
    purchase_order_lines_origin_shape_check;

ALTER TABLE purchase_order_lines
  ADD CONSTRAINT
    purchase_order_lines_provenance_check
  CHECK (
    provenance IN (
      'LIVE_DEMAND',
      'LEGACY_AUTHORIZATION',
      'DIRECT_AUTHORIZATION'
    )
  );

ALTER TABLE purchase_order_lines
  ADD CONSTRAINT
    purchase_order_lines_origin_shape_check
  CHECK (
    (
      provenance = 'LIVE_DEMAND'
      AND projected_demand_line_id IS NOT NULL
      AND projected_demand_revision IS NOT NULL
      AND projected_demand_revision > 0
      AND demand_bucket IN (
        'REGULAR',
        'LATE'
      )
      AND compensar_unit_rate_snapshot IS NOT NULL
      AND tariff_snapshot_provenance = 'LIVE_SNAPSHOT'
      AND legacy_tariff_revision_id IS NULL
    )
    OR
    (
      provenance = 'LEGACY_AUTHORIZATION'
      AND projected_demand_line_id IS NULL
      AND projected_demand_revision IS NULL
      AND demand_bucket IS NULL
    )
    OR
    (
      provenance = 'DIRECT_AUTHORIZATION'
      AND projected_demand_line_id IS NULL
      AND projected_demand_revision IS NULL
      AND demand_bucket IS NULL
      AND compensar_unit_rate_snapshot IS NOT NULL
      AND tariff_snapshot_provenance = 'LIVE_SNAPSHOT'
      AND legacy_tariff_revision_id IS NULL
    )
  );


ALTER TABLE purchase_order_authorization_sources
  DROP CONSTRAINT IF EXISTS
    purchase_order_authorization_sources_provenance_check;

ALTER TABLE purchase_order_authorization_sources
  DROP CONSTRAINT IF EXISTS
    purchase_order_authorization_sources_origin_shape_check;

ALTER TABLE purchase_order_authorization_sources
  ADD CONSTRAINT
    purchase_order_authorization_sources_provenance_check
  CHECK (
    provenance IN (
      'LIVE_DEMAND',
      'LEGACY_DIRECT_ASSIGNMENT',
      'LEGACY_CURRENT_STATE',
      'DIRECT_AUTHORIZATION'
    )
  );

ALTER TABLE purchase_order_authorization_sources
  ADD CONSTRAINT
    purchase_order_authorization_sources_origin_shape_check
  CHECK (
    (
      provenance = 'LIVE_DEMAND'
      AND projected_demand_line_id IS NOT NULL
      AND projected_demand_revision IS NOT NULL
      AND projected_demand_revision > 0
      AND evidence_at IS NULL
    )
    OR
    (
      provenance = 'LEGACY_DIRECT_ASSIGNMENT'
      AND projected_demand_line_id IS NULL
      AND projected_demand_revision IS NULL
      AND evidence_at IS NOT NULL
    )
    OR
    (
      provenance = 'LEGACY_CURRENT_STATE'
      AND projected_demand_line_id IS NULL
      AND projected_demand_revision IS NULL
      AND evidence_at IS NULL
    )
    OR
    (
      provenance = 'DIRECT_AUTHORIZATION'
      AND projected_demand_line_id IS NULL
      AND projected_demand_revision IS NULL
      AND evidence_at IS NOT NULL
    )
  );

COMMENT ON COLUMN purchase_orders.origin IS
  'OPERATIONAL=demanda proyectada; LEGACY_BACKFILL=histórico; DIRECT_AUTHORIZATION=OC creada directamente desde autorizaciones.';
