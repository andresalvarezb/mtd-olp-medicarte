-- Complete operational delivery and receipt evidence.
--
-- Server evidence and actor-declared dates remain independent.
-- Multiple physical receipts are allowed for the same dispatched delivery.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS dispatched_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deliveries_dispatched_by_fk'
  ) THEN
    ALTER TABLE deliveries
      ADD CONSTRAINT deliveries_dispatched_by_fk
      FOREIGN KEY (dispatched_by)
      REFERENCES users(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

-- Historical model allowed only one receipt per delivery.
-- Operational model permits 1..N receipts while physical quantity remains.
DROP INDEX IF EXISTS receipts_delivery_idx;

CREATE INDEX IF NOT EXISTS receipts_delivery_idx
  ON receipts(delivery_id);
