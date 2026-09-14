-- ESP-009: physical stock transfers are ledger movements, never mutable balances.
CREATE TABLE "stock_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "destination_dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "status" varchar(20) NOT NULL DEFAULT 'CREATED',
  "dispatched_at" timestamptz,
  "received_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_transfers_points_different_check" CHECK (source_dispensing_point_id <> destination_dispensing_point_id),
  CONSTRAINT "stock_transfers_status_check" CHECK (status IN ('CREATED','DISPATCHED','RECEIVED','CANCELLED')),
  CONSTRAINT "stock_transfers_version_check" CHECK (version > 0)
);
CREATE INDEX "stock_transfers_status_created_idx" ON "stock_transfers" (status, created_at);
CREATE TABLE "stock_transfer_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stock_transfer_id" uuid NOT NULL REFERENCES "stock_transfers"("id") ON DELETE RESTRICT,
  "source_inventory_lot_id" uuid NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "lot_number" varchar(255) NOT NULL,
  "expiration_date" date NOT NULL,
  "quantity" integer NOT NULL,
  CONSTRAINT "stock_transfer_lines_quantity_check" CHECK (quantity > 0)
);
CREATE INDEX "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" (stock_transfer_id);
INSERT INTO permissions (id,code,description) VALUES
  (gen_random_uuid(),'stock_transfers.read','Read stock transfers'),
  (gen_random_uuid(),'stock_transfers.manage','Manage stock transfers') ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN','MTD_OPERATOR','MTD_GENERAL','MTD_AUDITORIA','MEDICARTE_OPERATOR') AND p.code='stock_transfers.read'
ON CONFLICT DO NOTHING;
DELETE FROM role_permissions
WHERE permission_id=(SELECT id FROM permissions WHERE code='stock_transfers.manage')
  AND role_id<>(SELECT id FROM roles WHERE code='MEDICARTE_OPERATOR');
INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'MEDICARTE_OPERATOR' AND p.code='stock_transfers.manage'
ON CONFLICT DO NOTHING;
