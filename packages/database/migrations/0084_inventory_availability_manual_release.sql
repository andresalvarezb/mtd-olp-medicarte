ALTER TABLE inventory_allocation_batches
ADD COLUMN IF NOT EXISTS released_quantity integer
NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'inventory_allocation_batches_released_quantity_check'
  ) THEN
    ALTER TABLE inventory_allocation_batches
    ADD CONSTRAINT
      inventory_allocation_batches_released_quantity_check
    CHECK (
      released_quantity >= 0
    );
  END IF;
END
$$;


ALTER TABLE inventory_allocation_import_rows
ADD COLUMN IF NOT EXISTS operation_type varchar(30)
NOT NULL DEFAULT 'ASSIGN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'inventory_allocation_import_rows_operation_check'
  ) THEN
    ALTER TABLE inventory_allocation_import_rows
    ADD CONSTRAINT
      inventory_allocation_import_rows_operation_check
    CHECK (
      operation_type IN (
        'ASSIGN',
        'RELEASE_EXPIRED'
      )
    );
  END IF;
END
$$;


CREATE TABLE IF NOT EXISTS
inventory_allocation_release_events (
  id uuid PRIMARY KEY
    DEFAULT gen_random_uuid(),

  allocation_id uuid NOT NULL
    REFERENCES inventory_authorization_allocations(id)
    ON DELETE RESTRICT,

  batch_id uuid NOT NULL
    REFERENCES inventory_allocation_batches(id)
    ON DELETE RESTRICT,

  source_import_row_id uuid NOT NULL
    REFERENCES inventory_allocation_import_rows(id)
    ON DELETE RESTRICT,

  organization_id uuid NOT NULL
    REFERENCES organizations(id)
    ON DELETE RESTRICT,

  authorization_item_id uuid NOT NULL
    REFERENCES authorization_items(id)
    ON DELETE RESTRICT,

  purchase_order_id uuid NOT NULL
    REFERENCES purchase_orders(id)
    ON DELETE RESTRICT,

  released_quantity integer NOT NULL,

  reason varchar(40) NOT NULL,

  created_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  CONSTRAINT
    inventory_allocation_release_events_quantity_check
  CHECK (
    released_quantity > 0
  ),

  CONSTRAINT
    inventory_allocation_release_events_reason_check
  CHECK (
    reason IN (
      'AUTHORIZATION_EXPIRED'
    )
  ),

  CONSTRAINT
    inventory_allocation_release_events_allocation_row_unique
  UNIQUE (
    allocation_id,
    source_import_row_id
  )
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_release_events_batch_idx
ON inventory_allocation_release_events (
  batch_id,
  created_at
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_release_events_authorization_idx
ON inventory_allocation_release_events (
  authorization_item_id,
  created_at
);
