-- Wave 2A
--
-- Canonical logistics relationship:
--
-- INVIMA expediente + presentation
--                ->
-- MEDICARTE delivery/dispensing point
--
-- This relationship is intentionally independent from patient scheduling
-- and independent from a specific authorization.
--
-- Existing purchase_order_lines keep dispensing_point_id as the immutable
-- operational snapshot for historical purchase orders.

CREATE TABLE product_delivery_point_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  invima_record_normalized varchar(255) NOT NULL,
  invima_presentation_normalized varchar(255) NOT NULL,

  source_cum_code varchar(255) NOT NULL,
  service_model varchar(255),
  source_site_name varchar(160) NOT NULL,

  dispensing_point_id uuid NOT NULL
    REFERENCES dispensing_points(id)
    ON DELETE RESTRICT,

  version integer NOT NULL DEFAULT 1,

  created_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  updated_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_delivery_point_mappings_identity_unique
    UNIQUE (
      invima_record_normalized,
      invima_presentation_normalized
    ),

  CONSTRAINT product_delivery_point_mappings_record_check
    CHECK (
      invima_record_normalized ~ '^[0-9]+$'
    ),

  CONSTRAINT product_delivery_point_mappings_presentation_check
    CHECK (
      invima_presentation_normalized ~ '^[0-9]+$'
    ),

  CONSTRAINT product_delivery_point_mappings_cum_check
    CHECK (
      length(btrim(source_cum_code)) > 0
    ),

  CONSTRAINT product_delivery_point_mappings_site_check
    CHECK (
      length(btrim(source_site_name)) > 0
    ),

  CONSTRAINT product_delivery_point_mappings_version_check
    CHECK (
      version > 0
    )
);

CREATE INDEX product_delivery_point_mappings_point_idx
  ON product_delivery_point_mappings (
    dispensing_point_id
  );

CREATE INDEX product_delivery_point_mappings_identity_idx
  ON product_delivery_point_mappings (
    invima_record_normalized,
    invima_presentation_normalized,
    dispensing_point_id
  );
