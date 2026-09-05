-- Normaliza evidencia histórica al encabezado canónico. Los archivos nuevos
-- ya convierten NUM_DOCUMENTO durante el parsing mediante canonicalizeHeader.
UPDATE "authorization_items"
SET "source_data" = ("source_data" - 'NUM_DOCUMENTO') ||
  jsonb_build_object('IDENTIFICACION_PACIENTE', "source_data"->'NUM_DOCUMENTO')
WHERE "source_data" ? 'NUM_DOCUMENTO'
  AND NOT ("source_data" ? 'IDENTIFICACION_PACIENTE');

UPDATE "novelties"
SET "original_row" = ("original_row" - 'NUM_DOCUMENTO') ||
  jsonb_build_object('IDENTIFICACION_PACIENTE', "original_row"->'NUM_DOCUMENTO')
WHERE "original_row" ? 'NUM_DOCUMENTO'
  AND NOT ("original_row" ? 'IDENTIFICACION_PACIENTE');
