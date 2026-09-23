-- Tariff incident controls. No destructive changes and no access to raw clone.
ALTER TABLE tariff_annex_products ADD COLUMN IF NOT EXISTS tarifa_unidad_canonical numeric(18,4);
ALTER TABLE tariff_annex_import_rows ADD COLUMN IF NOT EXISTS tarifa_unidad_raw text;
ALTER TABLE tariff_annex_import_rows ADD COLUMN IF NOT EXISTS tarifa_unidad_canonical numeric(18,4);
ALTER TABLE tariff_annex_import_rows ADD COLUMN IF NOT EXISTS anomaly_code varchar(80);
ALTER TABLE tariff_annex_import_rows ADD COLUMN IF NOT EXISTS provenance jsonb;
UPDATE tariff_annex_products SET tarifa_unidad_canonical = CASE WHEN tarifa_unidad ~ '^[-+]?[0-9]+([.,][0-9]{1,4})?$' THEN replace(tarifa_unidad,',','.')::numeric(18,4) END WHERE tarifa_unidad_canonical IS NULL;
CREATE TABLE IF NOT EXISTS tariff_product_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES tariff_annex_products(id) ON DELETE RESTRICT,
 codigo_producto varchar(255) NOT NULL, revision integer NOT NULL, import_id uuid REFERENCES tariff_annex_imports(id) ON DELETE RESTRICT,
 import_row_id uuid REFERENCES tariff_annex_import_rows(id) ON DELETE RESTRICT, tarifa_unidad_raw text,
 tarifa_unidad_canonical numeric(18,4), tipo_inclusion varchar(100), commercial_snapshot jsonb NOT NULL,
 valid_from timestamptz NOT NULL, valid_to timestamptz, changed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 provenance text NOT NULL, UNIQUE(product_id, revision));
CREATE INDEX IF NOT EXISTS tariff_product_revisions_code_idx ON tariff_product_revisions(codigo_producto, valid_from);
CREATE TABLE IF NOT EXISTS authorization_tariff_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), authorization_item_id uuid NOT NULL REFERENCES authorization_items(id) ON DELETE RESTRICT,
 product_id uuid REFERENCES tariff_annex_products(id) ON DELETE RESTRICT, product_revision_id uuid REFERENCES tariff_product_revisions(id) ON DELETE RESTRICT,
 import_id uuid REFERENCES tariff_annex_imports(id) ON DELETE RESTRICT, codigo_producto varchar(255) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'UNRESOLVED',
 tarifa_unidad_raw text, tarifa_unidad_canonical numeric(18,4), tipo_inclusion varchar(100), snapshot_at timestamptz NOT NULL DEFAULT now(),
 provenance text NOT NULL, unresolved_reason text, UNIQUE(authorization_item_id));
ALTER TABLE authorization_tariff_snapshots ADD CONSTRAINT authorization_tariff_snapshots_status_check CHECK (status IN ('RESOLVED','UNRESOLVED','NOT_APPLICABLE'));
CREATE INDEX IF NOT EXISTS authorization_tariff_snapshots_import_idx ON authorization_tariff_snapshots(import_id);
CREATE OR REPLACE FUNCTION reject_tariff_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tariff provenance is append-only'; END; $$;
DROP TRIGGER IF EXISTS tariff_product_revisions_immutable ON tariff_product_revisions;
CREATE TRIGGER tariff_product_revisions_immutable BEFORE UPDATE OR DELETE ON tariff_product_revisions FOR EACH ROW EXECUTE FUNCTION reject_tariff_snapshot_mutation();
DROP TRIGGER IF EXISTS authorization_tariff_snapshots_immutable ON authorization_tariff_snapshots;
CREATE TRIGGER authorization_tariff_snapshots_immutable BEFORE UPDATE OR DELETE ON authorization_tariff_snapshots FOR EACH ROW EXECUTE FUNCTION reject_tariff_snapshot_mutation();
INSERT INTO tariff_product_revisions (product_id,codigo_producto,revision,import_id,import_row_id,tarifa_unidad_raw,tarifa_unidad_canonical,tipo_inclusion,commercial_snapshot,valid_from,changed_by,provenance)
SELECT p.id,p.codigo_producto,row_number() over (partition by p.id order by i.created_at,r.row_number),i.id,r.id,r.raw_data->>'TARIFA_UNIDAD',
 CASE WHEN r.raw_data->>'TARIFA_UNIDAD' ~ '^[-+]?[0-9]+([.,][0-9]{1,4})?$' THEN replace(r.raw_data->>'TARIFA_UNIDAD',',','.')::numeric(18,4) END,
 r.raw_data->>'TIPO_INCLUSION_MEDICAMENTO',r.raw_data,i.created_at,i.created_by,'BACKFILL:tariff_annex_import_rows'
FROM tariff_annex_import_rows r JOIN tariff_annex_imports i ON i.id=r.import_id JOIN tariff_annex_products p ON p.id=r.product_id
WHERE r.result_code IN ('PRODUCT_CREATED','PRODUCT_EXISTING','PRODUCT_REACTIVATED') ON CONFLICT (product_id,revision) DO NOTHING;
INSERT INTO authorization_tariff_snapshots (authorization_item_id,codigo_producto,provenance,unresolved_reason)
SELECT id,codigo_medicamento,'BACKFILL:authorization_item_without_monetary_snapshot','NO_MONETARY_VALUE_PERSISTED; tariff_rule_version is rule lineage only'
FROM authorization_items ON CONFLICT (authorization_item_id) DO NOTHING;
