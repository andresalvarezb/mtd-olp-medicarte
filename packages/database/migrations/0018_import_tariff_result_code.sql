ALTER TABLE "import_rows"
  DROP CONSTRAINT "import_rows_result_code_check";
--> statement-breakpoint
ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_result_code_check"
  CHECK ("result_code" IN (
    'ROW_VALID',
    'MISSING_REQUIRED_FIELD',
    'INVALID_FIELD_FORMAT',
    'DUPLICATE_IN_FILE',
    'EXISTING_ITEM_REVIEW_REQUIRED',
    'EXPLICIT_UPDATE_NOT_ALLOWED',
    'ITEM_CREATED',
    'ITEM_UPDATED',
    'PRODUCT_NOT_IN_TARIFF_ANNEX',
    'PROCESSING_ERROR'
  ));
