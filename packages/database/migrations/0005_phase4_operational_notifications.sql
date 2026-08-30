CREATE TABLE "bulk_update_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"operation_type" varchar(40) NOT NULL,
	"contract_version" integer NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" varchar(30) DEFAULT 'UPLOADED' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"unchanged_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(80),
	"correlation_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "bulk_update_batches_size_bytes_check" CHECK ("bulk_update_batches"."size_bytes" > 0 AND "bulk_update_batches"."size_bytes" <= 20971520),
	CONSTRAINT "bulk_update_batches_status_check" CHECK ("bulk_update_batches"."status" IN ('UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "bulk_update_batches_operation_type_check" CHECK ("bulk_update_batches"."operation_type" IN ('ASSIGN_DISPENSATION_LOCATION', 'REPORT_DISPENSATION_DATE', 'REPORT_APPLICATION_DATE'))
);
--> statement-breakpoint
CREATE TABLE "bulk_update_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"authorization_key" varchar(511),
	"authorization_item_id" uuid,
	"field_name" varchar(120),
	"previous_value" text,
	"new_value" text,
	"field_version" integer,
	"result_code" varchar(40) NOT NULL,
	"result_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_update_rows_batch_row_unique" UNIQUE("batch_id","row_number"),
	CONSTRAINT "bulk_update_rows_row_number_check" CHECK ("bulk_update_rows"."row_number" > 0),
	CONSTRAINT "bulk_update_rows_result_code_check" CHECK ("bulk_update_rows"."result_code" IN ('ROW_UPDATED', 'UNCHANGED_VALUE', 'INVALID_FILE_FORMAT', 'FILE_TOO_LARGE', 'INVALID_HEADERS', 'MISSING_BUSINESS_KEY', 'DUPLICATE_KEY_IN_FILE', 'AUTHORIZATION_ITEM_NOT_FOUND', 'FORBIDDEN_ITEM_SCOPE', 'OPERATION_NOT_ALLOWED', 'MISSING_VALUE', 'INVALID_VALUE_FORMAT', 'INVALID_OPERATION_STATE', 'VERSION_CONFLICT', 'PROCESSING_ERROR'))
);
--> statement-breakpoint
CREATE TABLE "bulk_update_source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "bulk_update_source_files_size_bytes_check" CHECK ("bulk_update_source_files"."size_bytes" > 0 AND "bulk_update_source_files"."size_bytes" <= 20971520)
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_type" varchar(60) NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_type" varchar(60) NOT NULL,
	"version" integer NOT NULL,
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_version_check" CHECK ("notification_templates"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_type" varchar(60) NOT NULL,
	"recipient_organization_id" uuid,
	"item_id" uuid,
	"period" date,
	"item_set_hash" varchar(64),
	"template_version" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"params" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"gmail_message_id" varchar(255),
	"correlation_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."notification_type" IN ('AUTHORIZATION_READY_TO_DISPENSE', 'DISPENSATION_LOCATION_ASSIGNED', 'DISPENSATION_LOCATION_CHANGED', 'EPS_DIRECTION_PENDING', 'DAILY_OPERATIONAL_REPORT'))
);
--> statement-breakpoint
CREATE TABLE "operational_field_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_item_id" uuid NOT NULL,
	"field_name" varchar(120) NOT NULL,
	"previous_value" text,
	"new_value" text NOT NULL,
	"previous_operational_version" integer NOT NULL,
	"new_operational_version" integer NOT NULL,
	"operation_type" varchar(40) NOT NULL,
	"bulk_update_batch_id" uuid,
	"bulk_update_row_id" uuid,
	"actor_type" varchar(30) NOT NULL,
	"actor_id" uuid,
	"organization_id" uuid,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_field_changes_version_check" CHECK ("operational_field_changes"."new_operational_version" > "operational_field_changes"."previous_operational_version")
);
--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "lugar_dispensacion" text;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "operational_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bulk_update_batches" ADD CONSTRAINT "bulk_update_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_update_batches" ADD CONSTRAINT "bulk_update_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_update_rows" ADD CONSTRAINT "bulk_update_rows_batch_id_bulk_update_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bulk_update_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_update_rows" ADD CONSTRAINT "bulk_update_rows_authorization_item_id_authorization_items_id_fk" FOREIGN KEY ("authorization_item_id") REFERENCES "public"."authorization_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_update_source_files" ADD CONSTRAINT "bulk_update_source_files_batch_id_bulk_update_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bulk_update_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_organization_id_organizations_id_fk" FOREIGN KEY ("recipient_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_item_id_authorization_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."authorization_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_field_changes" ADD CONSTRAINT "operational_field_changes_authorization_item_id_authorization_items_id_fk" FOREIGN KEY ("authorization_item_id") REFERENCES "public"."authorization_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_field_changes" ADD CONSTRAINT "operational_field_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_update_batches_org_idx" ON "bulk_update_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "bulk_update_batches_hash_idx" ON "bulk_update_batches" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "bulk_update_rows_batch_result_idx" ON "bulk_update_rows" USING btree ("batch_id","result_code","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_update_source_files_batch_idx" ON "bulk_update_source_files" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipients_unique_idx" ON "notification_recipients" USING btree ("notification_type","organization_id","email");--> statement-breakpoint
CREATE INDEX "notification_recipients_lookup_idx" ON "notification_recipients" USING btree ("notification_type","organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_type_version_idx" ON "notification_templates" USING btree ("notification_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_key_idx" ON "notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("notification_type","created_at");--> statement-breakpoint
CREATE INDEX "operational_field_changes_item_idx" ON "operational_field_changes" USING btree ("authorization_item_id","created_at");--> statement-breakpoint
-- Fase 4: permisos de bulk updates tipados, consulta de lotes y
-- administracion de notificaciones (ADR-020/ADR-022/DEC-005).
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000018', 'bulk_updates.dispensation_location', 'Assign dispensation locations through the typed bulk update pipeline'),
  ('30000000-0000-4000-8000-000000000019', 'bulk_updates.read', 'Read bulk update batches and per-row results'),
  ('30000000-0000-4000-8000-000000000020', 'notifications.manage', 'Manage notification recipients and retry failed notifications');
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000001', "id" FROM "permissions"
WHERE "code" IN ('bulk_updates.read', 'notifications.manage');
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000002', "id" FROM "permissions"
WHERE "code" = 'bulk_updates.read';
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000004', "id" FROM "permissions"
WHERE "code" = 'bulk_updates.read';
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000005', "id" FROM "permissions"
WHERE "code" IN ('bulk_updates.dispensation_location', 'bulk_updates.read', 'exports.create');
--> statement-breakpoint
-- Usuario MEDICARTE para operacion y verificacion de la fase.
INSERT INTO "users" ("id", "oidc_subject", "email", "display_name", "active") VALUES
  ('40000000-0000-4000-8000-000000000004', '45555555-5555-4555-8555-555555555555', 'medicarte@example.test', 'Medicarte Operator', true);
--> statement-breakpoint
INSERT INTO "user_organization_roles" ("user_id", "organization_id", "role_id") VALUES
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005');
--> statement-breakpoint
-- Plantillas versionadas v1 (SPEC-004). Los destinatarios se administran por
-- permiso y quedan auditados; no se siembran correos de negocio.
INSERT INTO "notification_templates" ("id", "notification_type", "version", "subject_template", "body_template") VALUES
  ('50000000-0000-4000-8000-000000000001', 'AUTHORIZATION_READY_TO_DISPENSE', 1,
   'Autorizacion {{authorizationKey}} lista para dispensar',
   'La autorizacion {{authorizationKey}} (medicamento {{codigoMedicamento}}, cobertura {{coverageType}}) esta lista para dispensar. Identificador operativo: {{itemId}}. Version de disponibilidad: {{readinessVersion}}.'),
  ('50000000-0000-4000-8000-000000000002', 'DISPENSATION_LOCATION_ASSIGNED', 1,
   'Lugar de dispensacion asignado — {{authorizationKey}}',
   'Medicarte asigno el lugar de dispensacion para {{authorizationKey}} (medicamento {{codigoMedicamento}}). Lugar vigente: {{lugarDispensacion}}. Version: {{fieldVersion}}. Fecha del cambio: {{changedAt}}.'),
  ('50000000-0000-4000-8000-000000000003', 'DISPENSATION_LOCATION_CHANGED', 1,
   'Lugar de dispensacion actualizado — {{authorizationKey}}',
   'Medicarte actualizo el lugar de dispensacion para {{authorizationKey}} (medicamento {{codigoMedicamento}}). Lugar vigente: {{lugarDispensacion}}. Version: {{fieldVersion}}. Fecha del cambio: {{changedAt}}.'),
  ('50000000-0000-4000-8000-000000000004', 'EPS_DIRECTION_PENDING', 1,
   'Autorizaciones pendientes de direccionamiento MIPRES — {{period}}',
   'Resumen consolidado de autorizaciones NO PBS habilitadas pendientes de direccionamiento MIPRES para el periodo {{period}}.{{itemList}}'),
  ('50000000-0000-4000-8000-000000000005', 'DAILY_OPERATIONAL_REPORT', 1,
   'Reporte operativo {{period}}',
   'Consolidado de novedades del dia {{period}} para {{organizationName}}.{{summary}}');
