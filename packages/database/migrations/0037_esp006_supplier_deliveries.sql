-- ESP-006: physical supplier deliveries. Receipt and inventory belong to ESP-007.
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_status_check";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check"
  CHECK ("status" IN ('DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'CANCELLED', 'IN_FULFILLMENT', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED'));

CREATE TABLE "deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  "supplier_reference" varchar(255),
  "status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
  "dispatched_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deliveries_status_check" CHECK ("status" IN ('DRAFT', 'DISPATCHED', 'CANCELLED')),
  CONSTRAINT "deliveries_version_check" CHECK ("version" > 0)
);
CREATE INDEX "deliveries_order_status_idx" ON "deliveries" ("purchase_order_id", "status", "created_at");

CREATE TABLE "delivery_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL REFERENCES "deliveries"("id") ON DELETE RESTRICT,
  "purchase_order_line_id" uuid NOT NULL REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "lot_number" varchar(255) NOT NULL,
  "expiration_date" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_lines_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "delivery_lines_delivery_idx" ON "delivery_lines" ("delivery_id");
CREATE INDEX "delivery_lines_order_line_idx" ON "delivery_lines" ("purchase_order_line_id");

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'supplier_deliveries.read', 'Read supplier deliveries'),
  (gen_random_uuid(), 'supplier_deliveries.manage', 'Create, update and dispatch supplier deliveries')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'OLP_OPERATOR' AND p."code" IN ('supplier_deliveries.read', 'supplier_deliveries.manage')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY', 'MEDICARTE_OPERATOR')
  AND p."code" = 'supplier_deliveries.read'
ON CONFLICT DO NOTHING;
