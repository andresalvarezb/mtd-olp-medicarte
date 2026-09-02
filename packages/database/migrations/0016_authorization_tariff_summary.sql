ALTER TABLE "import_batches"
  ADD COLUMN "tariff_rejected_rows" integer NOT NULL DEFAULT 0;
ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_tariff_rejected_rows_check"
  CHECK ("tariff_rejected_rows" >= 0);
