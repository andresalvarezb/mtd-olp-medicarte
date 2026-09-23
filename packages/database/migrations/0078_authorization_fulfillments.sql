CREATE TABLE authorization_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL
    REFERENCES organizations(id)
    ON DELETE RESTRICT,

  authorization_item_id uuid NOT NULL
    REFERENCES authorization_items(id)
    ON DELETE RESTRICT,

  fulfillment_type varchar(20) NOT NULL,

  effective_date date NOT NULL,

  quantity integer NOT NULL,

  source varchar(10) NOT NULL DEFAULT 'UI',

  confirmed_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  confirmed_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT authorization_fulfillments_authorization_unique
    UNIQUE (authorization_item_id),

  CONSTRAINT authorization_fulfillments_type_check
    CHECK (
      fulfillment_type IN (
        'APPLICATION',
        'DELIVERY'
      )
    ),

  CONSTRAINT authorization_fulfillments_quantity_check
    CHECK (quantity > 0),

  CONSTRAINT authorization_fulfillments_source_check
    CHECK (
      source IN (
        'UI',
        'XLSX'
      )
    )
);

CREATE INDEX authorization_fulfillments_effective_idx
  ON authorization_fulfillments (
    effective_date,
    authorization_item_id
  );

CREATE TABLE authorization_fulfillment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  fulfillment_id uuid NOT NULL
    REFERENCES authorization_fulfillments(id)
    ON DELETE RESTRICT,

  inventory_authorization_allocation_id uuid NOT NULL
    REFERENCES inventory_authorization_allocations(id)
    ON DELETE RESTRICT,

  purchase_order_id uuid NOT NULL
    REFERENCES purchase_orders(id)
    ON DELETE RESTRICT,

  inventory_lot_id uuid NOT NULL
    REFERENCES inventory_lots(id)
    ON DELETE RESTRICT,

  commercial_code varchar(255) NOT NULL,

  dispensing_point_id uuid NOT NULL
    REFERENCES dispensing_points(id)
    ON DELETE RESTRICT,

  lot_number varchar(255) NOT NULL,

  expiration_date date NOT NULL,

  quantity integer NOT NULL,

  CONSTRAINT authorization_fulfillment_lines_quantity_check
    CHECK (quantity > 0),

  CONSTRAINT authorization_fulfillment_lines_identity_unique
    UNIQUE (
      fulfillment_id,
      inventory_authorization_allocation_id,
      inventory_lot_id
    )
);

CREATE INDEX authorization_fulfillment_lines_fulfillment_idx
  ON authorization_fulfillment_lines (
    fulfillment_id
  );

CREATE INDEX authorization_fulfillment_lines_allocation_idx
  ON authorization_fulfillment_lines (
    inventory_authorization_allocation_id
  );


ALTER TABLE inventory_movements
  DROP CONSTRAINT inventory_movements_type_check;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_type_check
  CHECK (
    movement_type IN (
      'RECEIPT',
      'APPLICATION',
      'FULFILLMENT_APPLICATION',
      'FULFILLMENT_DELIVERY',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'DAMAGE',
      'EXPIRATION',
      'RETURN_TO_SUPPLIER',
      'ADJUSTMENT',
      'NON_REUSABLE'
    )
  );

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_fulfillment_delta_check
  CHECK (
    movement_type NOT IN (
      'FULFILLMENT_APPLICATION',
      'FULFILLMENT_DELIVERY'
    )
    OR quantity_delta < 0
  );
