CREATE INDEX "inventory_authorization_allocations_active_scope_idx"
  ON "inventory_authorization_allocations" ("dispensing_point_id", "authorization_item_id")
  WHERE "status" IN ('ALLOCATED', 'PARTIALLY_CONSUMED');
