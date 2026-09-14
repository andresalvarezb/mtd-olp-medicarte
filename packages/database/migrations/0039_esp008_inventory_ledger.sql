-- ESP-008: operational inventory is derived exclusively from the movement ledger.
CREATE TABLE "inventory_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "commercial_code" varchar(255) NOT NULL,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "lot_number" varchar(255) NOT NULL,
  "expiration_date" date NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_lots_identity_unique" UNIQUE("commercial_code","dispensing_point_id","lot_number","expiration_date"),
  CONSTRAINT "inventory_lots_commercial_code_check" CHECK (length(btrim("commercial_code")) > 0),
  CONSTRAINT "inventory_lots_number_check" CHECK (length(btrim("lot_number")) > 0)
);
CREATE INDEX "inventory_lots_point_product_idx" ON "inventory_lots" ("dispensing_point_id","commercial_code");
CREATE TABLE "inventory_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inventory_lot_id" uuid NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT,
  "movement_type" varchar(30) NOT NULL,
  "quantity_delta" integer NOT NULL,
  "source_type" varchar(40) NOT NULL,
  "source_id" uuid NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_movements_source_semantics_unique" UNIQUE("movement_type","source_type","source_id"),
  CONSTRAINT "inventory_movements_type_check" CHECK ("movement_type" IN ('RECEIPT','APPLICATION','TRANSFER_OUT','TRANSFER_IN','DAMAGE','EXPIRATION','RETURN_TO_SUPPLIER','ADJUSTMENT','NON_REUSABLE')),
  CONSTRAINT "inventory_movements_quantity_delta_check" CHECK ("quantity_delta" <> 0),
  CONSTRAINT "inventory_movements_source_type_check" CHECK (length(btrim("source_type")) > 0),
  CONSTRAINT "inventory_movements_receipt_delta_check" CHECK ("movement_type" <> 'RECEIPT' OR "quantity_delta" > 0)
);
CREATE INDEX "inventory_movements_lot_occurred_idx" ON "inventory_movements" ("inventory_lot_id","occurred_at");
CREATE FUNCTION enforce_receipt_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE accepted integer;
BEGIN
  IF NEW.movement_type = 'RECEIPT' THEN
    IF NEW.source_type <> 'RECEIPT_LINE' THEN
      RAISE EXCEPTION 'RECEIPT movement source must be RECEIPT_LINE';
    END IF;
    SELECT rl.accepted_quantity INTO accepted
      FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id
      WHERE rl.id=NEW.source_id AND r.status='CONFIRMED';
    IF accepted IS NULL OR accepted <= 0 OR NEW.quantity_delta <> accepted THEN
      RAISE EXCEPTION 'RECEIPT movement requires confirmed accepted receipt quantity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_movements_receipt_guard
  BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION enforce_receipt_inventory_movement();
INSERT INTO "permissions" ("id","code","description") VALUES (gen_random_uuid(),'inventory.read','Read operational inventory') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN','MTD_OPERATOR','MTD_GENERAL','MTD_AUDITORIA','MEDICARTE_OPERATOR')
  AND p."code"='inventory.read' ON CONFLICT DO NOTHING;
