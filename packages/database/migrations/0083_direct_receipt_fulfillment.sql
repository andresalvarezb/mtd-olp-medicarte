ALTER TABLE authorization_fulfillment_lines
  ALTER COLUMN inventory_lot_id
    DROP NOT NULL;

ALTER TABLE authorization_fulfillment_lines
  ALTER COLUMN lot_number
    DROP NOT NULL;

ALTER TABLE authorization_fulfillment_lines
  ALTER COLUMN expiration_date
    DROP NOT NULL;


ALTER TABLE authorization_fulfillment_lines
  DROP CONSTRAINT IF EXISTS
    authorization_fulfillment_lines_identity_unique;


DROP INDEX IF EXISTS
  authorization_fulfillment_lines_lot_unique;

DROP INDEX IF EXISTS
  authorization_fulfillment_lines_direct_unique;


CREATE UNIQUE INDEX
  authorization_fulfillment_lines_lot_unique
ON authorization_fulfillment_lines (
  fulfillment_id,
  inventory_authorization_allocation_id,
  inventory_lot_id
)
WHERE inventory_lot_id IS NOT NULL;


CREATE UNIQUE INDEX
  authorization_fulfillment_lines_direct_unique
ON authorization_fulfillment_lines (
  fulfillment_id,
  inventory_authorization_allocation_id
)
WHERE inventory_lot_id IS NULL;


ALTER TABLE authorization_fulfillment_lines
  DROP CONSTRAINT IF EXISTS
    authorization_fulfillment_lines_evidence_check;

ALTER TABLE authorization_fulfillment_lines
  ADD CONSTRAINT
    authorization_fulfillment_lines_evidence_check
  CHECK (
    (
      inventory_lot_id IS NULL
      AND lot_number IS NULL
      AND expiration_date IS NULL
    )
    OR
    (
      inventory_lot_id IS NOT NULL
      AND lot_number IS NOT NULL
      AND expiration_date IS NOT NULL
    )
  );
