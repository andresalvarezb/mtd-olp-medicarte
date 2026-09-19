-- Macro 3B:
-- A purchase order can be created from authorization-driven demand
-- before a physical logistics point or requested delivery date exists.
--
-- Historical purchase orders keep their existing values and FK.

ALTER TABLE purchase_order_lines
  ALTER COLUMN dispensing_point_id DROP NOT NULL;

ALTER TABLE purchase_order_lines
  ALTER COLUMN requested_delivery_date DROP NOT NULL;
