ALTER TABLE inventory_allocation_batches
  DROP CONSTRAINT inventory_allocation_batches_source_check;

ALTER TABLE inventory_allocation_batches
  ADD CONSTRAINT inventory_allocation_batches_source_check
  CHECK (source IN ('UI', 'XLSX', 'AUTO')) NOT VALID;

ALTER TABLE inventory_allocation_batches
  VALIDATE CONSTRAINT inventory_allocation_batches_source_check;
