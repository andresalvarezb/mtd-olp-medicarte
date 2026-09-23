-- OC operational lifecycle.
--
-- System timestamps and actor-declared dates are intentionally
-- independent. Audit timestamps must never be overwritten with
-- a business-declared date.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS olp_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS olp_accepted_by uuid,
  ADD COLUMN IF NOT EXISTS olp_committed_date date;

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS declared_dispatch_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'purchase_orders_olp_accepted_by_fk'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT
        purchase_orders_olp_accepted_by_fk
      FOREIGN KEY (olp_accepted_by)
      REFERENCES users(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'purchase_orders_olp_acceptance_consistency'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT
        purchase_orders_olp_acceptance_consistency
      CHECK (
        (
          olp_accepted_at IS NULL
          AND olp_accepted_by IS NULL
          AND olp_committed_date IS NULL
        )
        OR
        (
          olp_accepted_at IS NOT NULL
          AND olp_accepted_by IS NOT NULL
          AND olp_committed_date IS NOT NULL
        )
      );
  END IF;
END
$$;
