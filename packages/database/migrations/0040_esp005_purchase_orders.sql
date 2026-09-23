-- ESP-005: consolidated purchase orders are logistics documents, never clinical
-- documents. All line values needed by OLP are snapshots.
CREATE TABLE "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_code" varchar(255),
  "planning_period_id" uuid NOT NULL REFERENCES "planning_periods"("id") ON DELETE RESTRICT,
  "order_type" varchar(20) NOT NULL,
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "issued_at" timestamp with time zone,
  "issued_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_orders_type_check" CHECK ("order_type" IN ('STANDARD', 'COMPLEMENTARY')),
  CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT "purchase_orders_version_check" CHECK ("version" > 0)
);
CREATE INDEX "purchase_orders_period_status_idx" ON "purchase_orders" ("planning_period_id", "status", "created_at");
CREATE UNIQUE INDEX "purchase_orders_code_idx" ON "purchase_orders" ("purchase_order_code") WHERE "purchase_order_code" IS NOT NULL;

CREATE TABLE "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  "commercial_code" varchar(255) NOT NULL,
  "product_description" text,
  "presentation" text,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "requested_quantity" integer NOT NULL,
  "accepted_quantity" integer,
  "requested_delivery_date" date NOT NULL,
  "compensar_unit_rate_snapshot" varchar(255) NOT NULL,
  "supplier_unit_cost" varchar(255),
  -- Historical identifier only; never blocks replacement of live demand.
  "projected_demand_line_id" uuid NOT NULL,
  "projected_demand_revision" integer NOT NULL,
  "demand_bucket" varchar(20) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_lines_requested_quantity_check" CHECK ("requested_quantity" > 0),
  CONSTRAINT "purchase_order_lines_accepted_quantity_check" CHECK ("accepted_quantity" IS NULL OR ("accepted_quantity" >= 0 AND "accepted_quantity" <= "requested_quantity")),
  CONSTRAINT "purchase_order_lines_revision_check" CHECK ("projected_demand_revision" > 0),
  CONSTRAINT "purchase_order_lines_bucket_check" CHECK ("demand_bucket" IN ('REGULAR', 'LATE')),
  CONSTRAINT "purchase_order_lines_supplier_cost_check" CHECK ("accepted_quantity" IS NULL OR "accepted_quantity" = 0 OR ("supplier_unit_cost" IS NOT NULL AND "supplier_unit_cost"::numeric > 0))
);
CREATE INDEX "purchase_order_lines_order_idx" ON "purchase_order_lines" ("purchase_order_id");
CREATE INDEX "purchase_order_lines_demand_idx" ON "purchase_order_lines" ("projected_demand_line_id", "projected_demand_revision");

CREATE TABLE "purchase_order_demand_allocations" (
  "purchase_order_line_id" uuid NOT NULL REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT,
  "projected_demand_line_id" uuid NOT NULL,
  "projected_demand_revision" integer NOT NULL,
  "demand_bucket" varchar(20) NOT NULL,
  "allocated_quantity" integer NOT NULL,
  CONSTRAINT "purchase_order_demand_allocations_pk" PRIMARY KEY ("purchase_order_line_id", "projected_demand_line_id", "projected_demand_revision", "demand_bucket"),
  CONSTRAINT "purchase_order_demand_allocations_quantity_check" CHECK ("allocated_quantity" > 0),
  CONSTRAINT "purchase_order_demand_allocations_bucket_check" CHECK ("demand_bucket" IN ('REGULAR', 'LATE'))
);

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'purchase_orders.read', 'Read consolidated purchase orders'),
  (gen_random_uuid(), 'purchase_orders.manage', 'Create and manage MTD purchase orders'),
  (gen_random_uuid(), 'purchase_orders.review_supplier', 'Review purchase order lines as supplier')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY') AND p."code" = 'purchase_orders.read'
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR') AND p."code" = 'purchase_orders.manage'
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'OLP_OPERATOR' AND p."code" IN ('purchase_orders.read', 'purchase_orders.review_supplier')
ON CONFLICT DO NOTHING;
