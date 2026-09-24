-- Cumulative OLP management compatibility.
--
-- OPERATIONAL purchase orders accepted before olp_managed_quantity
-- already used accepted_quantity as the supplier commitment.
-- Preserve that fact in the new cumulative operational field.
--
-- LEGACY_BACKFILL is intentionally excluded because accepted_quantity
-- may represent reconstructed historical supplier evidence.

UPDATE purchase_order_lines pol
SET
  olp_managed_quantity =
    LEAST(
      pol.requested_quantity,
      COALESCE(
        pol.accepted_quantity,
        pol.requested_quantity
      )
    ),
  updated_at =
    now()
FROM purchase_orders po
WHERE
  po.id =
    pol.purchase_order_id
  AND po.origin =
    'OPERATIONAL'
  AND po.olp_accepted_at
    IS NOT NULL
  AND pol.olp_managed_quantity
    IS NULL;
