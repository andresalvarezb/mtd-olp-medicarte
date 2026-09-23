-- Macro 3C / W1
-- Separate physical inventory location from the historical MEDICARTE
-- dispensing-point concept.
--
-- This wave is additive:
-- - inventory_lots continues using dispensing_point_id;
-- - existing physical flows remain unchanged;
-- - every existing dispensing point receives a legacy inventory-location map;
-- - future inventory locations may exist without a dispensing point.

CREATE TABLE inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL
    REFERENCES organizations(id)
    ON DELETE RESTRICT,

  code varchar(80) NOT NULL,
  name varchar(160) NOT NULL,

  active boolean NOT NULL DEFAULT true,

  legacy_dispensing_point_id uuid
    REFERENCES dispensing_points(id)
    ON DELETE RESTRICT,

  created_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  updated_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_locations_code_not_blank_check
    CHECK (length(btrim(code)) > 0),

  CONSTRAINT inventory_locations_name_not_blank_check
    CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX inventory_locations_organization_code_idx
  ON inventory_locations (
    organization_id,
    code
  );

CREATE UNIQUE INDEX inventory_locations_legacy_point_idx
  ON inventory_locations (
    legacy_dispensing_point_id
  )
  WHERE legacy_dispensing_point_id IS NOT NULL;

CREATE INDEX inventory_locations_active_idx
  ON inventory_locations (
    organization_id,
    active,
    code
  );

-- Bootstrap legacy locations.
--
-- The inventory-location ID is deliberately independent from the historical
-- dispensing-point ID. Consumers must use the mapping instead of assuming
-- both identities are interchangeable.
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
ON CONFLICT (
  organization_id,
  code
) DO NOTHING;
