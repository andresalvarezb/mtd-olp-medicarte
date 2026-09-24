-- OLP managed quantity for the universal purchase-order flow.
--
-- This is new operational evidence and must not overwrite
-- accepted_quantity reconstructed from historical supplier evidence.

ALTER TABLE purchase_order_lines
  ADD COLUMN olp_managed_quantity integer;

ALTER TABLE purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_olp_managed_quantity_check
  CHECK (
    olp_managed_quantity IS NULL
    OR (
      olp_managed_quantity >= 0
      AND olp_managed_quantity <= requested_quantity
    )
  );

COMMENT ON COLUMN purchase_order_lines.olp_managed_quantity IS
  'Quantity OLP commits to manage in the universal purchase-order operational flow.';
