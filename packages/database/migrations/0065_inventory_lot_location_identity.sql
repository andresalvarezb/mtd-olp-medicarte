-- Macro 3C / W2
--
-- inventory_location_id becomes the canonical physical-location identity
-- for production-written inventory lots.
--
-- dispensing_point_id remains temporarily as a compatibility projection for:
-- - historical inventory readers,
-- - patient application flows,
-- - stock-transfer contracts,
-- - historical integration fixtures.
--
-- The new column intentionally remains nullable during the transition.
-- Existing rows are fully backfilled and production writers dual-write both
-- identities. Legacy-only test fixtures remain structurally valid until the
-- compatibility layer is removed in a later wave.

ALTER TABLE inventory_lots
  ADD COLUMN inventory_location_id uuid;

UPDATE inventory_lots lot
SET inventory_location_id = location.id
FROM inventory_locations location
WHERE location.legacy_dispensing_point_id =
      lot.dispensing_point_id
  AND lot.inventory_location_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM inventory_lots lot
    WHERE lot.inventory_location_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'INVENTORY_LOT_LOCATION_BACKFILL_INCOMPLETE';
  END IF;
END
$$;

ALTER TABLE inventory_lots
  ADD CONSTRAINT inventory_lots_inventory_location_fk
  FOREIGN KEY (inventory_location_id)
  REFERENCES inventory_locations(id)
  ON DELETE RESTRICT;

-- Required by the composite compatibility FK below.
-- id is already globally unique, but PostgreSQL requires the exact referenced
-- column set to be backed by a unique constraint/index.
CREATE UNIQUE INDEX inventory_locations_id_legacy_point_idx
  ON inventory_locations (
    id,
    legacy_dispensing_point_id
  );

-- While dispensing_point_id exists, any non-null canonical location must be
-- the inventory location mapped to that same legacy point.
ALTER TABLE inventory_lots
  ADD CONSTRAINT inventory_lots_location_point_fk
  FOREIGN KEY (
    inventory_location_id,
    dispensing_point_id
  )
  REFERENCES inventory_locations (
    id,
    legacy_dispensing_point_id
  )
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX inventory_lots_location_identity_unique
  ON inventory_lots (
    commercial_code,
    inventory_location_id,
    lot_number,
    expiration_date
  )
  WHERE inventory_location_id IS NOT NULL;

CREATE INDEX inventory_lots_location_product_idx
  ON inventory_lots (
    inventory_location_id,
    commercial_code
  )
  WHERE inventory_location_id IS NOT NULL;
