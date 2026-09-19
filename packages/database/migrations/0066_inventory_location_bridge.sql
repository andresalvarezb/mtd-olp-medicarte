-- Macro 3C
--
-- dispensing_points is now a legacy compatibility source for physical
-- inventory locations, not the canonical inventory identity.
--
-- Goals:
-- 1. Every legacy dispensing point has an inventory location.
-- 2. New legacy points are synchronized automatically.
-- 3. Deleting a legacy point does not delete its inventory-location history.
-- 4. A previously orphaned location code can be rebound to a recreated point.

ALTER TABLE inventory_locations
  DROP CONSTRAINT IF EXISTS
    inventory_locations_legacy_dispensing_point_id_fkey;

ALTER TABLE inventory_locations
  ADD CONSTRAINT
    inventory_locations_legacy_dispensing_point_id_fkey
  FOREIGN KEY (legacy_dispensing_point_id)
  REFERENCES dispensing_points(id)
  ON DELETE SET NULL;

INSERT INTO inventory_locations (
  organization_id,
  code,
  name,
  active,
  legacy_dispensing_point_id,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  dp.organization_id,
  dp.code,
  dp.name,
  dp.active,
  dp.id,
  dp.created_by,
  dp.created_by,
  dp.created_at,
  dp.created_at
FROM dispensing_points dp
ON CONFLICT (organization_id, code)
DO UPDATE SET
  name = EXCLUDED.name,
  active = EXCLUDED.active,
  legacy_dispensing_point_id =
    EXCLUDED.legacy_dispensing_point_id,
  updated_by = EXCLUDED.updated_by,
  updated_at = now()
WHERE
  inventory_locations.legacy_dispensing_point_id IS NULL
  OR inventory_locations.legacy_dispensing_point_id =
     EXCLUDED.legacy_dispensing_point_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dispensing_points dp
    WHERE NOT EXISTS (
      SELECT 1
      FROM inventory_locations il
      WHERE il.legacy_dispensing_point_id = dp.id
    )
  ) THEN
    RAISE EXCEPTION
      'INVENTORY_LOCATION_BRIDGE_BACKFILL_INCOMPLETE';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION
  sync_inventory_location_from_dispensing_point()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO inventory_locations (
    organization_id,
    code,
    name,
    active,
    legacy_dispensing_point_id,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  VALUES (
    NEW.organization_id,
    NEW.code,
    NEW.name,
    NEW.active,
    NEW.id,
    NEW.created_by,
    NEW.created_by,
    NEW.created_at,
    now()
  )
  ON CONFLICT (organization_id, code)
  DO UPDATE SET
    name = EXCLUDED.name,
    active = EXCLUDED.active,
    legacy_dispensing_point_id =
      EXCLUDED.legacy_dispensing_point_id,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  WHERE
    inventory_locations.legacy_dispensing_point_id IS NULL
    OR inventory_locations.legacy_dispensing_point_id =
       EXCLUDED.legacy_dispensing_point_id;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_locations il
    WHERE il.legacy_dispensing_point_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'INVENTORY_LOCATION_MAPPING_CONFLICT:%:%',
      NEW.organization_id,
      NEW.code;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS
  dispensing_points_inventory_location_sync
ON dispensing_points;

CREATE TRIGGER
  dispensing_points_inventory_location_sync
AFTER INSERT OR UPDATE OF
  organization_id,
  code,
  name,
  active
ON dispensing_points
FOR EACH ROW
EXECUTE FUNCTION
  sync_inventory_location_from_dispensing_point();
