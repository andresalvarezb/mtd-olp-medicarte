-- SPEC-014 / ADR-024: Anexo Tarifario — catálogo operativo administrado por MTD.
-- La llave de validación es codigo_medicamento (COD_COMERCIAL normalizado).

CREATE TABLE "tariff_annex_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo_producto" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_annex_products_version_check" CHECK ("tariff_annex_products"."version" > 0),
	CONSTRAINT "tariff_annex_products_code_length_check" CHECK (length("tariff_annex_products"."codigo_producto") > 0)
);--> statement-breakpoint
ALTER TABLE "tariff_annex_products" ADD CONSTRAINT "tariff_annex_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "tariff_annex_products" ADD CONSTRAINT "tariff_annex_products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "tariff_annex_products" ADD CONSTRAINT "tariff_annex_products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_annex_products_code_idx" ON "tariff_annex_products" USING btree ("codigo_producto");--> statement-breakpoint
CREATE INDEX "tariff_annex_products_active_idx" ON "tariff_annex_products" USING btree ("active","codigo_producto");--> statement-breakpoint

CREATE TABLE "tariff_annex_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" varchar(30) DEFAULT 'UPLOADED' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"reactivated_rows" integer DEFAULT 0 NOT NULL,
	"existing_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(80),
	"correlation_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tariff_annex_imports_size_bytes_check" CHECK ("tariff_annex_imports"."size_bytes" > 0 AND "tariff_annex_imports"."size_bytes" <= 20971520),
	CONSTRAINT "tariff_annex_imports_status_check" CHECK ("tariff_annex_imports"."status" IN ('UPLOADED', 'VALIDATING', 'COMPLETED', 'FAILED'))
);--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ADD CONSTRAINT "tariff_annex_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ADD CONSTRAINT "tariff_annex_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE INDEX "tariff_annex_imports_org_idx" ON "tariff_annex_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_annex_imports_logical_key_idx" ON "tariff_annex_imports" USING btree ("organization_id","sha256");--> statement-breakpoint

CREATE TABLE "tariff_annex_import_source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" bytea,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "tariff_annex_import_source_files_size_bytes_check" CHECK ("tariff_annex_import_source_files"."size_bytes" > 0 AND "tariff_annex_import_source_files"."size_bytes" <= 20971520)
);--> statement-breakpoint
ALTER TABLE "tariff_annex_import_source_files" ADD CONSTRAINT "tariff_annex_import_source_files_import_id_tariff_annex_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "tariff_annex_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_annex_import_source_files_import_idx" ON "tariff_annex_import_source_files" USING btree ("import_id");--> statement-breakpoint

CREATE TABLE "tariff_annex_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"codigo_producto" varchar(255),
	"result_code" varchar(80) NOT NULL,
	"result_message" text NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_annex_import_rows_import_row_unique" UNIQUE ("import_id", "row_number"),
	CONSTRAINT "tariff_annex_import_rows_row_number_check" CHECK ("tariff_annex_import_rows"."row_number" > 0),
	CONSTRAINT "tariff_annex_import_rows_result_code_check" CHECK ("tariff_annex_import_rows"."result_code" IN ('PRODUCT_CREATED', 'PRODUCT_REACTIVATED', 'PRODUCT_EXISTING', 'INVALID_PRODUCT_CODE', 'DUPLICATE_IN_FILE', 'INVALID_FILE_FORMAT', 'PROCESSING_ERROR'))
);--> statement-breakpoint
ALTER TABLE "tariff_annex_import_rows" ADD CONSTRAINT "tariff_annex_import_rows_import_id_tariff_annex_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "tariff_annex_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "tariff_annex_import_rows" ADD CONSTRAINT "tariff_annex_import_rows_product_id_tariff_annex_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "tariff_annex_products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE INDEX "tariff_annex_import_rows_result_idx" ON "tariff_annex_import_rows" USING btree ("import_id","result_code","row_number");--> statement-breakpoint

-- Evidencia por ítem del resultado de la validación del Anexo Tarifario.
ALTER TABLE "authorization_items" ADD COLUMN "tariff_membership_status" varchar(30) DEFAULT 'NOT_EVALUATED' NOT NULL;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "tariff_membership_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "tariff_rule_version" varchar(40) DEFAULT 'TARIFF-ANNEX-1' NOT NULL;--> statement-breakpoint

-- Backfill: los ítems preexistentes fueron evaluados antes de que existiera el
-- Anexo Tarifario. Se marcan LISTED sin efecto retroactivo; las evaluaciones
-- futuras y las revalidaciones aplican la regla completa (ADR-024).
UPDATE "authorization_items" SET "tariff_membership_status" = 'LISTED', "tariff_membership_evaluated_at" = now();--> statement-breakpoint

CREATE INDEX "authorization_items_tariff_membership_idx" ON "authorization_items" USING btree ("codigo_medicamento","tariff_membership_status");--> statement-breakpoint

-- El invariante de listo-para-dispensar exige producto incluido en el Anexo.
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_ready_prerequisites_check";--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_ready_prerequisites_check" CHECK ("authorization_items"."operation_status" IS NULL OR "authorization_items"."operation_status" <> 'READY_TO_DISPENSE' OR (
  "authorization_items"."enablement_status" = 'ENABLED' AND "authorization_items"."tariff_membership_status" = 'LISTED' AND (
    ("authorization_items"."coverage_type" = 'PBS' AND "authorization_items"."direction_status" = 'NOT_APPLICABLE') OR
    ("authorization_items"."coverage_type" = 'NO_PBS' AND "authorization_items"."direction_status" = 'CONFIRMED')
  )
));--> statement-breakpoint

-- Permisos atómicos del Anexo Tarifario (solo organización MTD; el rol
-- administrativo los recibe por defecto, otros roles MTD solo por asignación
-- explícita de la matriz).
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000026', 'tariff_annex.read', 'View the tariff annex products and import results'),
  ('30000000-0000-4000-8000-000000000027', 'tariff_annex.create', 'Create individual tariff annex products'),
  ('30000000-0000-4000-8000-000000000028', 'tariff_annex.import', 'Bulk import tariff annex products'),
  ('30000000-0000-4000-8000-000000000029', 'tariff_annex.update', 'Update tariff annex products'),
  ('30000000-0000-4000-8000-000000000030', 'tariff_annex.delete', 'Deactivate tariff annex products')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_ADMIN'
  AND p."code" IN (
    'tariff_annex.read',
    'tariff_annex.create',
    'tariff_annex.import',
    'tariff_annex.update',
    'tariff_annex.delete'
  )
ON CONFLICT DO NOTHING;