ALTER TABLE tariff_annex_imports DROP CONSTRAINT IF EXISTS tariff_annex_imports_status_check;
ALTER TABLE tariff_annex_imports ADD CONSTRAINT tariff_annex_imports_status_check
  CHECK (status IN ('PREPARED','CONFIRMING','UPLOADED','VALIDATING','COMPLETED','FAILED','CANCELLED'));
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview jsonb;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview_total integer NOT NULL DEFAULT 0;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview_unchanged integer NOT NULL DEFAULT 0;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview_changed integer NOT NULL DEFAULT 0;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview_anomalous integer NOT NULL DEFAULT 0;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview_rejected integer NOT NULL DEFAULT 0;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS preview_scale_pattern_detected boolean NOT NULL DEFAULT false;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tariff_annex_imports ADD COLUMN IF NOT EXISTS override_reason text;
