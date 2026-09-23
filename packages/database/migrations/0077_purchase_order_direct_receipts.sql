CREATE TABLE purchase_order_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  purchase_order_id uuid NOT NULL
    REFERENCES purchase_orders(id)
    ON DELETE RESTRICT,

  received_at timestamptz NOT NULL DEFAULT now(),

  confirmed_at timestamptz NOT NULL DEFAULT now(),

  confirmed_by uuid NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  observation text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX purchase_order_receipts_order_idx
  ON purchase_order_receipts (
    purchase_order_id,
    confirmed_at
  );


CREATE TABLE purchase_order_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  receipt_id uuid NOT NULL
    REFERENCES purchase_order_receipts(id)
    ON DELETE CASCADE,

  purchase_order_line_id uuid NOT NULL
    REFERENCES purchase_order_lines(id)
    ON DELETE RESTRICT,

  outcome varchar(30) NOT NULL,

  received_quantity integer NOT NULL,

  lot_number varchar(255),

  expiration_date date,

  observation text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT purchase_order_receipt_lines_outcome_check
    CHECK (
      outcome IN (
        'RECEIVED_COMPLETE',
        'RECEIVED_PARTIAL',
        'NOT_RECEIVED'
      )
    ),

  CONSTRAINT purchase_order_receipt_lines_quantity_check
    CHECK (
      received_quantity >= 0
    ),

  CONSTRAINT purchase_order_receipt_lines_evidence_check
    CHECK (
      (
        outcome = 'NOT_RECEIVED'
        AND received_quantity = 0
        AND lot_number IS NULL
        AND expiration_date IS NULL
      )
      OR
      (
        outcome IN (
          'RECEIVED_COMPLETE',
          'RECEIVED_PARTIAL'
        )
        AND received_quantity > 0
        AND lot_number IS NOT NULL
        AND length(btrim(lot_number)) > 0
        AND expiration_date IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX purchase_order_receipt_lines_receipt_line_unique
  ON purchase_order_receipt_lines (
    receipt_id,
    purchase_order_line_id
  );

CREATE INDEX purchase_order_receipt_lines_po_line_idx
  ON purchase_order_receipt_lines (
    purchase_order_line_id
  );
