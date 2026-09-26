-- AUTO ingestion must preserve every identifiable authorization.
--
-- UNCLASSIFIED represents an AUTO whose commercial code cannot yet be
-- classified by the active tariff annex.
--
-- operation_status is HISTORICAL_ONLY. It must not prevent updating the
-- authoritative source/validation fields of an AUTO during smart reload.

ALTER TABLE authorization_items
DROP CONSTRAINT IF EXISTS authorization_items_coverage_type_check;

ALTER TABLE authorization_items
ADD CONSTRAINT authorization_items_coverage_type_check
CHECK (
  coverage_type IN (
    'UNCLASSIFIED',
    'PBS',
    'NO_PBS'
  )
);

ALTER TABLE authorization_items
DROP CONSTRAINT IF EXISTS authorization_items_ready_prerequisites_check;
