-- Restore the historical-source guard before the migration transaction
-- commits. This is also safe on databases where 0104 and 0105 already ran.
ALTER TABLE purchase_order_authorization_sources
  ENABLE TRIGGER trg_guard_annulled_purchase_order_sources;
