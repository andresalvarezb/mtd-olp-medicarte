-- 0104 backfills actor metadata on historical released sources. The 0101
-- immutability trigger rejects that backfill, so suspend only this trigger
-- while the pending migrations run in Drizzle's single transaction.
-- 0106 restores it before that transaction commits.
ALTER TABLE purchase_order_authorization_sources
  DISABLE TRIGGER trg_guard_annulled_purchase_order_sources;
