BEGIN;

DO $$
DECLARE
  v_orders integer;
  v_lines integer;
  v_sources integer;
  v_units bigint;
BEGIN
  SELECT
    count(DISTINCT upper(btrim(orden_compra))),
    count(*),
    sum((source_data->>'CANTIDAD')::integer)
  INTO
    v_orders,
    v_sources,
    v_units
  FROM authorization_items
  WHERE orden_compra IS NOT NULL
    AND btrim(orden_compra) <> ''
    AND upper(btrim(orden_compra)) <> '0';

  SELECT count(*)
  INTO v_lines
  FROM (
    SELECT
      upper(btrim(orden_compra)),
      upper(btrim(codigo_medicamento))
    FROM authorization_items
    WHERE orden_compra IS NOT NULL
      AND btrim(orden_compra) <> ''
      AND upper(btrim(orden_compra)) <> '0'
    GROUP BY
      upper(btrim(orden_compra)),
      upper(btrim(codigo_medicamento))
  ) q;

  IF v_orders <> 13 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_EXPECTED_13_ORDERS actual=%',
      v_orders;
  END IF;

  IF v_lines <> 114 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_EXPECTED_114_LINES actual=%',
      v_lines;
  END IF;

  IF v_sources <> 3009 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_EXPECTED_3009_SOURCES actual=%',
      v_sources;
  END IF;

  IF v_units <> 10666 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_EXPECTED_10666_UNITS actual=%',
      v_units;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM authorization_items
    WHERE orden_compra IS NOT NULL
      AND btrim(orden_compra) <> ''
      AND upper(btrim(orden_compra)) <> '0'
      AND (
        source_data->>'CANTIDAD' IS NULL
        OR btrim(source_data->>'CANTIDAD') !~ '^[1-9][0-9]*$'
      )
  ) THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_INVALID_QUANTITY';
  END IF;
END
$$;


DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM purchase_orders po
    JOIN (
      SELECT DISTINCT
        upper(btrim(orden_compra)) AS oc
      FROM authorization_items
      WHERE orden_compra IS NOT NULL
        AND btrim(orden_compra) <> ''
        AND upper(btrim(orden_compra)) <> '0'
    ) src
      ON upper(btrim(po.purchase_order_code)) = src.oc
    WHERE po.origin <> 'LEGACY_BACKFILL'
  ) THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_CONFLICT_WITH_OPERATIONAL_PO';
  END IF;
END
$$;


WITH first_assignment AS (
  SELECT DISTINCT ON (
    upper(btrim(new_value))
  )
    upper(btrim(new_value)) AS oc,
    actor_id,
    created_at AS assigned_at
  FROM operational_field_changes
  WHERE field_name = 'ORDEN_COMPRA'
    AND operation_type = 'ASSIGN_PURCHASE_ORDER'
    AND new_value IS NOT NULL
    AND btrim(new_value) <> ''
    AND upper(btrim(new_value)) <> '0'
  ORDER BY
    upper(btrim(new_value)),
    created_at,
    id
),
current_orders AS (
  SELECT DISTINCT
    upper(btrim(orden_compra)) AS oc
  FROM authorization_items
  WHERE orden_compra IS NOT NULL
    AND btrim(orden_compra) <> ''
    AND upper(btrim(orden_compra)) <> '0'
)
INSERT INTO purchase_orders (
  purchase_order_code,
  planning_period_id,
  order_type,
  status,
  origin,
  version,
  issued_at,
  issued_by,
  legacy_assigned_at,
  legacy_assigned_by,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  o.oc,
  NULL,
  NULL,
  'HISTORICAL_ONLY',
  'LEGACY_BACKFILL',
  1,
  NULL,
  NULL,
  fa.assigned_at,
  fa.actor_id,
  fa.actor_id,
  fa.actor_id,
  fa.assigned_at,
  fa.assigned_at
FROM current_orders o
JOIN first_assignment fa
  ON fa.oc = o.oc
WHERE NOT EXISTS (
  SELECT 1
  FROM purchase_orders po
  WHERE upper(btrim(po.purchase_order_code)) = o.oc
);


WITH first_assignment AS (
  SELECT DISTINCT ON (
    upper(btrim(new_value))
  )
    upper(btrim(new_value)) AS oc,
    created_at AS assigned_at
  FROM operational_field_changes
  WHERE field_name = 'ORDEN_COMPRA'
    AND operation_type = 'ASSIGN_PURCHASE_ORDER'
    AND new_value IS NOT NULL
    AND btrim(new_value) <> ''
    AND upper(btrim(new_value)) <> '0'
  ORDER BY
    upper(btrim(new_value)),
    created_at,
    id
),
legacy_lines AS (
  SELECT
    upper(btrim(ai.orden_compra)) AS oc,
    upper(btrim(ai.codigo_medicamento)) AS commercial_code,
    sum(
      (ai.source_data->>'CANTIDAD')::integer
    ) AS requested_quantity
  FROM authorization_items ai
  WHERE ai.orden_compra IS NOT NULL
    AND btrim(ai.orden_compra) <> ''
    AND upper(btrim(ai.orden_compra)) <> '0'
  GROUP BY
    upper(btrim(ai.orden_compra)),
    upper(btrim(ai.codigo_medicamento))
),
resolved AS (
  SELECT
    ll.*,
    fa.assigned_at,
    po.id AS purchase_order_id,
    rev.id AS tariff_revision_id,
    rev.tarifa_unidad_canonical AS unit_rate
  FROM legacy_lines ll
  JOIN first_assignment fa
    ON fa.oc = ll.oc
  JOIN purchase_orders po
    ON upper(btrim(po.purchase_order_code)) = ll.oc
   AND po.origin = 'LEGACY_BACKFILL'
  JOIN tariff_annex_products p
    ON upper(btrim(p.codigo_producto)) =
       ll.commercial_code
  LEFT JOIN LATERAL (
    SELECT tr.*
    FROM tariff_product_revisions tr
    WHERE tr.product_id = p.id
      AND tr.valid_from <= fa.assigned_at
    ORDER BY
      tr.valid_from DESC,
      tr.revision DESC,
      tr.id DESC
    LIMIT 1
  ) rev
    ON true
)
INSERT INTO purchase_order_lines (
  purchase_order_id,
  commercial_code,
  product_description,
  presentation,
  dispensing_point_id,
  requested_quantity,
  accepted_quantity,
  requested_delivery_date,
  compensar_unit_rate_snapshot,
  supplier_unit_cost,
  projected_demand_line_id,
  projected_demand_revision,
  demand_bucket,
  provenance,
  tariff_snapshot_provenance,
  legacy_tariff_revision_id,
  created_at,
  updated_at
)
SELECT
  r.purchase_order_id,
  r.commercial_code,
  NULL,
  NULL,
  NULL,
  r.requested_quantity,
  NULL,
  NULL,
  CASE
    WHEN r.unit_rate IS NOT NULL
      THEN r.unit_rate::text
    ELSE NULL
  END,
  NULL,
  NULL,
  NULL,
  NULL,
  'LEGACY_AUTHORIZATION',
  CASE
    WHEN r.tariff_revision_id IS NULL
      THEN 'LEGACY_UNRESOLVED'
    WHEN r.unit_rate IS NULL
      THEN 'LEGACY_REVISION_NO_RATE'
    ELSE 'LEGACY_DERIVED_REVISION'
  END,
  r.tariff_revision_id,
  r.assigned_at,
  r.assigned_at
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1
  FROM purchase_order_lines pol
  WHERE pol.purchase_order_id =
        r.purchase_order_id
    AND upper(btrim(pol.commercial_code)) =
        r.commercial_code
);


WITH current_sources AS (
  SELECT
    ai.id AS authorization_item_id,
    upper(btrim(ai.orden_compra)) AS oc,
    upper(btrim(ai.codigo_medicamento)) AS commercial_code,
    (ai.source_data->>'CANTIDAD')::integer
      AS source_quantity_snapshot
  FROM authorization_items ai
  WHERE ai.orden_compra IS NOT NULL
    AND btrim(ai.orden_compra) <> ''
    AND upper(btrim(ai.orden_compra)) <> '0'
),
resolved AS (
  SELECT
    cs.*,
    pol.id AS purchase_order_line_id,
    direct_event.evidence_at
  FROM current_sources cs
  JOIN purchase_orders po
    ON upper(btrim(po.purchase_order_code)) = cs.oc
   AND po.origin = 'LEGACY_BACKFILL'
  JOIN purchase_order_lines pol
    ON pol.purchase_order_id = po.id
   AND upper(btrim(pol.commercial_code)) =
       cs.commercial_code
   AND pol.provenance =
       'LEGACY_AUTHORIZATION'
  LEFT JOIN LATERAL (
    SELECT
      ofc.created_at AS evidence_at
    FROM operational_field_changes ofc
    WHERE ofc.authorization_item_id =
          cs.authorization_item_id
      AND ofc.field_name = 'ORDEN_COMPRA'
      AND ofc.operation_type =
          'ASSIGN_PURCHASE_ORDER'
      AND upper(btrim(ofc.new_value)) =
          cs.oc
    ORDER BY
      ofc.created_at,
      ofc.id
    LIMIT 1
  ) direct_event
    ON true
)
INSERT INTO purchase_order_authorization_sources (
  purchase_order_line_id,
  authorization_item_id,
  projected_demand_line_id,
  projected_demand_revision,
  source_quantity_snapshot,
  provenance,
  evidence_at
)
SELECT
  r.purchase_order_line_id,
  r.authorization_item_id,
  NULL,
  NULL,
  r.source_quantity_snapshot,
  CASE
    WHEN r.evidence_at IS NOT NULL
      THEN 'LEGACY_DIRECT_ASSIGNMENT'
    ELSE 'LEGACY_CURRENT_STATE'
  END,
  r.evidence_at
FROM resolved r
ON CONFLICT DO NOTHING;


DO $$
DECLARE
  v_orders integer;
  v_lines integer;
  v_sources integer;
  v_line_units bigint;
  v_source_units bigint;
  v_missing_rate integer;
  v_direct integer;
  v_current integer;
BEGIN
  SELECT count(*)
  INTO v_orders
  FROM purchase_orders
  WHERE origin = 'LEGACY_BACKFILL';

  SELECT
    count(*),
    sum(requested_quantity),
    count(*) FILTER (
      WHERE tariff_snapshot_provenance =
            'LEGACY_REVISION_NO_RATE'
    )
  INTO
    v_lines,
    v_line_units,
    v_missing_rate
  FROM purchase_order_lines
  WHERE provenance =
        'LEGACY_AUTHORIZATION';

  SELECT
    count(*),
    sum(source_quantity_snapshot),
    count(*) FILTER (
      WHERE provenance =
            'LEGACY_DIRECT_ASSIGNMENT'
    ),
    count(*) FILTER (
      WHERE provenance =
            'LEGACY_CURRENT_STATE'
    )
  INTO
    v_sources,
    v_source_units,
    v_direct,
    v_current
  FROM purchase_order_authorization_sources
  WHERE provenance IN (
    'LEGACY_DIRECT_ASSIGNMENT',
    'LEGACY_CURRENT_STATE'
  );

  IF v_orders <> 13 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_POST_ORDERS actual=%',
      v_orders;
  END IF;

  IF v_lines <> 114 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_POST_LINES actual=%',
      v_lines;
  END IF;

  IF v_sources <> 3009 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_POST_SOURCES actual=%',
      v_sources;
  END IF;

  IF v_line_units <> 10666
     OR v_source_units <> 10666 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_POST_UNITS lines=% sources=%',
      v_line_units,
      v_source_units;
  END IF;

  IF v_missing_rate <> 3 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_POST_MISSING_RATES actual=%',
      v_missing_rate;
  END IF;

  IF v_direct + v_current <> 3009 THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_POST_PROVENANCE direct=% current=%',
      v_direct,
      v_current;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM deliveries d
    JOIN purchase_orders po
      ON po.id = d.purchase_order_id
    WHERE po.origin =
          'LEGACY_BACKFILL'
  ) THEN
    RAISE EXCEPTION
      'LEGACY_BACKFILL_UNEXPECTED_DELIVERY';
  END IF;
END
$$;


SELECT
  (SELECT count(*)
   FROM purchase_orders
   WHERE origin = 'LEGACY_BACKFILL')
    AS purchase_orders,

  (SELECT count(*)
   FROM purchase_order_lines
   WHERE provenance =
         'LEGACY_AUTHORIZATION')
    AS purchase_order_lines,

  (SELECT count(*)
   FROM purchase_order_authorization_sources
   WHERE provenance IN (
     'LEGACY_DIRECT_ASSIGNMENT',
     'LEGACY_CURRENT_STATE'
   ))
    AS authorization_sources,

  (SELECT sum(requested_quantity)
   FROM purchase_order_lines
   WHERE provenance =
         'LEGACY_AUTHORIZATION')
    AS requested_units,

  (SELECT count(*)
   FROM purchase_order_lines
   WHERE tariff_snapshot_provenance =
         'LEGACY_REVISION_NO_RATE')
    AS lines_without_rate,

  (SELECT count(*)
   FROM purchase_order_authorization_sources
   WHERE provenance =
         'LEGACY_CURRENT_STATE')
    AS sources_from_current_state;

COMMIT;
