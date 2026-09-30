ALTER TABLE purchase_order_receipt_lines
  DROP CONSTRAINT IF EXISTS
    purchase_order_receipt_lines_evidence_check;

ALTER TABLE purchase_order_receipt_lines
  ADD CONSTRAINT
    purchase_order_receipt_lines_evidence_check
  CHECK (
    (
      outcome = 'NOT_RECEIVED'
      AND received_quantity = 0
    )
    OR
    (
      outcome IN (
        'RECEIVED_COMPLETE',
        'RECEIVED_PARTIAL'
      )
      AND received_quantity > 0
    )
  );
