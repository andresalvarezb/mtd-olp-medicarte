CREATE TABLE IF NOT EXISTS inventory_allocation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL
    REFERENCES organizations(id)
    ON DELETE RESTRICT,

  source varchar(10) NOT NULL,

  import_batch_id uuid
    REFERENCES import_batches(id)
    ON DELETE RESTRICT,

  status varchar(20) NOT NULL
    DEFAULT 'PREPARED',

  total_rows integer NOT NULL
    DEFAULT 0,

  valid_rows integer NOT NULL
    DEFAULT 0,

  invalid_rows integer NOT NULL
    DEFAULT 0,

  allocated_quantity integer NOT NULL
    DEFAULT 0,

  version integer NOT NULL
    DEFAULT 1,

  correlation_id uuid NOT NULL,

  created_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  confirmed_by uuid
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  confirmed_at timestamptz,

  cancelled_at timestamptz,

  CONSTRAINT inventory_allocation_batches_source_check
    CHECK (
      source IN (
        'UI',
        'XLSX'
      )
    ),

  CONSTRAINT inventory_allocation_batches_status_check
    CHECK (
      status IN (
        'PREPARED',
        'CONFIRMED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT inventory_allocation_batches_rows_check
    CHECK (
      total_rows >= 0
      AND valid_rows >= 0
      AND invalid_rows >= 0
      AND valid_rows + invalid_rows <= total_rows
    ),

  CONSTRAINT inventory_allocation_batches_quantity_check
    CHECK (
      allocated_quantity >= 0
    ),

  CONSTRAINT inventory_allocation_batches_version_check
    CHECK (
      version > 0
    )
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_batches_org_status_idx
ON inventory_allocation_batches (
  organization_id,
  status,
  created_at DESC
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_batches_import_idx
ON inventory_allocation_batches (
  import_batch_id
);


CREATE TABLE IF NOT EXISTS inventory_allocation_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id uuid NOT NULL
    REFERENCES inventory_allocation_batches(id)
    ON DELETE CASCADE,

  row_number integer NOT NULL,

  authorization_key varchar(511) NOT NULL,

  purchase_order_code varchar(255) NOT NULL,

  requested_quantity integer NOT NULL,

  resolved_authorization_item_id uuid
    REFERENCES authorization_items(id)
    ON DELETE RESTRICT,

  resolved_purchase_order_id uuid
    REFERENCES purchase_orders(id)
    ON DELETE RESTRICT,

  commercial_code varchar(255),

  expected_authorization_version integer,

  validation_status varchar(10) NOT NULL,

  execution_status varchar(10) NOT NULL
    DEFAULT 'PENDING',

  error_code varchar(100),

  error_message text,

  raw_payload jsonb NOT NULL,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  executed_at timestamptz,

  CONSTRAINT inventory_allocation_import_rows_batch_row_unique
    UNIQUE (
      batch_id,
      row_number
    ),

  CONSTRAINT inventory_allocation_import_rows_quantity_check
    CHECK (
      requested_quantity > 0
    ),

  CONSTRAINT inventory_allocation_import_rows_validation_check
    CHECK (
      validation_status IN (
        'VALID',
        'INVALID'
      )
    ),

  CONSTRAINT inventory_allocation_import_rows_execution_check
    CHECK (
      execution_status IN (
        'PENDING',
        'APPLIED',
        'SKIPPED',
        'FAILED'
      )
    ),

  CONSTRAINT inventory_allocation_import_rows_version_check
    CHECK (
      expected_authorization_version IS NULL
      OR expected_authorization_version > 0
    )
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_import_rows_batch_idx
ON inventory_allocation_import_rows (
  batch_id,
  row_number
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_import_rows_authorization_idx
ON inventory_allocation_import_rows (
  authorization_key
);

CREATE INDEX IF NOT EXISTS
  inventory_allocation_import_rows_purchase_order_idx
ON inventory_allocation_import_rows (
  purchase_order_code
);


CREATE TABLE IF NOT EXISTS inventory_authorization_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id uuid NOT NULL
    REFERENCES inventory_allocation_batches(id)
    ON DELETE RESTRICT,

  source_import_row_id uuid
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

  commercial_code varchar(255) NOT NULL,

  dispensing_point_id uuid NOT NULL
    REFERENCES dispensing_points(id)
    ON DELETE RESTRICT,

  allocated_quantity integer NOT NULL,

  consumed_quantity integer NOT NULL
    DEFAULT 0,

  released_quantity integer NOT NULL
    DEFAULT 0,

  status varchar(30) NOT NULL
    DEFAULT 'ALLOCATED',

  authorization_version integer NOT NULL,

  created_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  updated_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  updated_at timestamptz NOT NULL
    DEFAULT now(),

  CONSTRAINT inventory_authorization_allocations_quantity_check
    CHECK (
      allocated_quantity > 0
      AND consumed_quantity >= 0
      AND released_quantity >= 0
      AND consumed_quantity
        + released_quantity
        <= allocated_quantity
    ),

  CONSTRAINT inventory_authorization_allocations_status_check
    CHECK (
      status IN (
        'ALLOCATED',
        'PARTIALLY_CONSUMED',
        'CONSUMED',
        'RELEASED',
        'EXPIRED'
      )
    ),

  CONSTRAINT inventory_authorization_allocations_version_check
    CHECK (
      authorization_version > 0
    )
);

CREATE INDEX IF NOT EXISTS
  inventory_authorization_allocations_auth_idx
ON inventory_authorization_allocations (
  authorization_item_id,
  status
);

CREATE INDEX IF NOT EXISTS
  inventory_authorization_allocations_oc_product_idx
ON inventory_authorization_allocations (
  purchase_order_id,
  commercial_code,
  dispensing_point_id,
  status
);

CREATE INDEX IF NOT EXISTS
  inventory_authorization_allocations_product_point_idx
ON inventory_authorization_allocations (
  commercial_code,
  dispensing_point_id,
  status
);


INSERT INTO permissions (
  code,
  description
)
VALUES (
  'inventory.allocate',
  'Assign usable purchase-order inventory to authorizations'
)
ON CONFLICT (code)
DO NOTHING;


INSERT INTO role_permissions (
  role_id,
  permission_id
)
SELECT
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE
  r.code IN (
    'MTD_ADMIN',
    'MTD_OPERATOR',
    'MTD_GENERAL'
  )
  AND p.code =
    'inventory.allocate'
ON CONFLICT DO NOTHING;
