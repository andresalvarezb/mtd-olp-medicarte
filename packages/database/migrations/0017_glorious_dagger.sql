CREATE TABLE "pending_user_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_subject" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(160),
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "pending_user_requests_oidc_subject_unique" UNIQUE("oidc_subject")
);
--> statement-breakpoint
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
	CONSTRAINT "tariff_annex_import_rows_import_row_unique" UNIQUE("import_id","row_number"),
	CONSTRAINT "tariff_annex_import_rows_row_number_check" CHECK ("tariff_annex_import_rows"."row_number" > 0),
	CONSTRAINT "tariff_annex_import_rows_result_code_check" CHECK ("tariff_annex_import_rows"."result_code" IN ('PRODUCT_CREATED', 'PRODUCT_REACTIVATED', 'PRODUCT_EXISTING', 'INVALID_PRODUCT_CODE', 'DUPLICATE_IN_FILE', 'INVALID_FILE_FORMAT', 'PROCESSING_ERROR'))
);
--> statement-breakpoint
CREATE TABLE "tariff_annex_import_source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "tariff_annex_import_source_files_size_bytes_check" CHECK ("tariff_annex_import_source_files"."size_bytes" > 0 AND "tariff_annex_import_source_files"."size_bytes" <= 20971520)
);
--> statement-breakpoint
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
);
--> statement-breakpoint
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
);
--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_operation_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_ready_prerequisites_check";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "tariff_membership_status" varchar(30) DEFAULT 'NOT_EVALUATED' NOT NULL;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "tariff_membership_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "tariff_rule_version" varchar(40) DEFAULT 'TARIFF-ANNEX-1' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "reverted_by" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "reverted_removed_items" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "reverted_blocked_items" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_annex_import_rows" ADD CONSTRAINT "tariff_annex_import_rows_import_id_tariff_annex_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."tariff_annex_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_import_rows" ADD CONSTRAINT "tariff_annex_import_rows_product_id_tariff_annex_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tariff_annex_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_import_source_files" ADD CONSTRAINT "tariff_annex_import_source_files_import_id_tariff_annex_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."tariff_annex_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ADD CONSTRAINT "tariff_annex_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ADD CONSTRAINT "tariff_annex_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_products" ADD CONSTRAINT "tariff_annex_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_products" ADD CONSTRAINT "tariff_annex_products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_annex_products" ADD CONSTRAINT "tariff_annex_products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_user_requests_status_idx" ON "pending_user_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tariff_annex_import_rows_result_idx" ON "tariff_annex_import_rows" USING btree ("import_id","result_code","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_annex_import_source_files_import_idx" ON "tariff_annex_import_source_files" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "tariff_annex_imports_org_idx" ON "tariff_annex_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_annex_imports_logical_key_idx" ON "tariff_annex_imports" USING btree ("organization_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_annex_products_code_idx" ON "tariff_annex_products" USING btree ("codigo_producto");--> statement-breakpoint
CREATE INDEX "tariff_annex_products_active_idx" ON "tariff_annex_products" USING btree ("active","codigo_producto");--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authorization_items_tariff_membership_idx" ON "authorization_items" USING btree ("codigo_medicamento","tariff_membership_status");--> statement-breakpoint
CREATE INDEX "import_batches_reverted_idx" ON "import_batches" USING btree ("organization_id","reverted_at");--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_tariff_membership_status_check" CHECK ("authorization_items"."tariff_membership_status" IN ('NOT_EVALUATED', 'LISTED', 'NOT_LISTED'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_operation_status_check" CHECK ("authorization_items"."operation_status" IS NULL OR "authorization_items"."operation_status" IN ('BLOCKED', 'READY_TO_DISPENSE', 'DISPENSATION_REPORTED', 'DISPENSED', 'EXPIRED'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_ready_prerequisites_check" CHECK ("authorization_items"."operation_status" IS NULL OR "authorization_items"."operation_status" <> 'READY_TO_DISPENSE' OR (
        "authorization_items"."enablement_status" = 'ENABLED' AND "authorization_items"."tariff_membership_status" = 'LISTED' AND (
          ("authorization_items"."coverage_type" = 'PBS' AND "authorization_items"."direction_status" = 'NOT_APPLICABLE') OR
          ("authorization_items"."coverage_type" = 'NO_PBS' AND "authorization_items"."direction_status" = 'CONFIRMED')
        )
      ));--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_reverted_removed_items_check" CHECK ("import_batches"."reverted_removed_items" >= 0);--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_reverted_blocked_items_check" CHECK ("import_batches"."reverted_blocked_items" >= 0);--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_status_check" CHECK ("import_batches"."status" IN ('UPLOADED', 'VALIDATING', 'READY_TO_CONFIRM', 'CONFIRMING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERTING', 'REVERTED'));