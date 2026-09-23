-- Macro 3C / 3D
--
-- Physical stock remains traceable by lot/location.
-- Procurement availability is fungible by commercial_code.
--
-- inventory_usable_lots:
--   physical lots with positive balance and non-expired expiration date.
--
-- inventory_usable_by_product:
--   fungible usable balance by commercial_code across locations.
--
-- purchase_open_coverage_by_product:
--   purchase quantity still committed/inbound and therefore not yet
--   represented by usable inventory.
--
-- RECEIVED is deliberately zero open coverage. Once physically received,
-- supply must be represented by inventory movements instead of being
-- subtracted twice as both PO and stock.

CREATE OR REPLACE VIEW inventory_usable_lots AS
WITH lot_balances AS (
  SELECT
    l.id AS inventory_lot_id,
    l.commercial_code,
    l.inventory_location_id,
    l.dispensing_point_id,
    l.lot_number,
    l.expiration_date,
    COALESCE(
      SUM(m.quantity_delta),
      0
    )::int AS physical_balance
  FROM inventory_lots l
  LEFT JOIN inventory_movements m
    ON m.inventory_lot_id = l.id
  GROUP BY
    l.id,
    l.commercial_code,
    l.inventory_location_id,
    l.dispensing_point_id,
    l.lot_number,
    l.expiration_date
)
SELECT
  inventory_lot_id,
  commercial_code,
  inventory_location_id,
  dispensing_point_id,
  lot_number,
  expiration_date,
  physical_balance AS usable_balance
FROM lot_balances
WHERE
  expiration_date >=
    timezone('America/Bogota', now())::date
  AND physical_balance > 0;

CREATE OR REPLACE VIEW
  inventory_usable_by_product
AS
SELECT
  commercial_code,
  SUM(usable_balance)::int AS usable_quantity
FROM inventory_usable_lots
GROUP BY commercial_code;

CREATE OR REPLACE VIEW
  purchase_open_coverage_by_product
AS
WITH confirmed_receipts AS (
  SELECT
    dl.purchase_order_line_id,
    COALESCE(
      SUM(rl.accepted_quantity),
      0
    )::int AS terminal_accepted_quantity
  FROM receipt_lines rl
  JOIN receipts r
    ON r.id = rl.receipt_id
  JOIN delivery_lines dl
    ON dl.id = rl.delivery_line_id
  WHERE r.status = 'CONFIRMED'
  GROUP BY dl.purchase_order_line_id
),
line_coverage AS (
  SELECT
    pol.id,
    pol.commercial_code,
    CASE
      WHEN po.status IN (
        'REJECTED',
        'CANCELLED',
        'RECEIVED'
      )
        THEN 0

      WHEN po.status IN (
        'DRAFT',
        'ISSUED',
        'UNDER_OLP_REVIEW'
      )
        THEN pol.requested_quantity

      ELSE GREATEST(
        COALESCE(
          pol.accepted_quantity,
          0
        )
        -
        COALESCE(
          cr.terminal_accepted_quantity,
          0
        ),
        0
      )
    END::int AS open_quantity
  FROM purchase_order_lines pol
  JOIN purchase_orders po
    ON po.id = pol.purchase_order_id
  LEFT JOIN confirmed_receipts cr
    ON cr.purchase_order_line_id = pol.id
)
SELECT
  commercial_code,
  SUM(open_quantity)::int AS open_quantity
FROM line_coverage
WHERE open_quantity > 0
GROUP BY commercial_code;
