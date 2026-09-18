-- Macro Paso 1 / 1C:
-- PREPARE debe persistir resultados de preview sin fingir que el catálogo
-- activo ya fue modificado. Los códigos históricos PRODUCT_* se conservan.

ALTER TABLE "tariff_annex_import_rows"
  DROP CONSTRAINT IF EXISTS "tariff_annex_import_rows_result_code_check";
--> statement-breakpoint

ALTER TABLE "tariff_annex_import_rows"
  ADD CONSTRAINT "tariff_annex_import_rows_result_code_check"
  CHECK (
    "result_code" IN (
      'PREVIEW_NEW',
      'PREVIEW_UNCHANGED',
      'PREVIEW_CHANGED',
      'PREVIEW_ANOMALOUS',
      'PREVIEW_REJECTED',
      'PRODUCT_CREATED',
      'PRODUCT_REACTIVATED',
      'PRODUCT_EXISTING',
      'INVALID_PRODUCT_CODE',
      'DUPLICATE_IN_FILE',
      'INVALID_FILE_FORMAT',
      'PROCESSING_ERROR'
    )
  );
