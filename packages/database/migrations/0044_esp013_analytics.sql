-- ESP-013: analytics is a derived read model. No business fact tables.
INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'analytics.read', 'Read operational analytics'),
  (gen_random_uuid(), 'analytics.economics.read', 'Read economic analytics')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN','MTD_OPERATOR','MTD_GENERAL','MTD_AUDITORIA','READ_ONLY')
  AND p.code IN ('analytics.read','analytics.economics.read')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS "inventory_movements_type_lot_idx"
  ON "inventory_movements" ("movement_type", "inventory_lot_id");
CREATE INDEX IF NOT EXISTS "receipts_status_idx"
  ON "receipts" ("status");
CREATE INDEX IF NOT EXISTS "patient_applications_status_point_code_idx"
  ON "patient_applications" ("status", "dispensing_point_id", "commercial_code");
