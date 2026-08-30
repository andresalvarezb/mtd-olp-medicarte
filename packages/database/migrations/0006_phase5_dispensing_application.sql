ALTER TABLE "authorization_items" ADD COLUMN "fecha_dispensacion" date;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "fecha_aplicacion" date;--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "audit_status" varchar(30) DEFAULT 'NOT_STARTED' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "authorization_items" WHERE "operation_status" = 'DISPENSED') THEN
    RAISE EXCEPTION 'Fase 5 migration blocked: historical DISPENSED items require an explicit human-audit reconciliation before audit_status can be introduced';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "bulk_update_batches"
    GROUP BY "organization_id", "operation_type", "sha256", "contract_version"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Fase 5 migration blocked: duplicate logical bulk batches require explicit reconciliation';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "operational_field_changes" ADD COLUMN "idempotency_key" varchar(200);--> statement-breakpoint
UPDATE "operational_field_changes" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "operational_field_changes" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_update_batches_logical_key_idx" ON "bulk_update_batches" USING btree ("organization_id","operation_type","sha256","contract_version");--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_audit_status_check" CHECK ("authorization_items"."audit_status" IN ('NOT_STARTED', 'READY', 'IN_REVIEW', 'REJECTED', 'APPROVED'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_dispensed_requires_approval_check" CHECK ("authorization_items"."operation_status" <> 'DISPENSED' OR "authorization_items"."audit_status" = 'APPROVED');--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_approval_requires_dispensed_check" CHECK ("authorization_items"."audit_status" <> 'APPROVED' OR "authorization_items"."operation_status" = 'DISPENSED');--> statement-breakpoint
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000021', 'bulk_updates.dispensation_date', 'Report dispensation dates through the typed bulk update pipeline'),
  ('30000000-0000-4000-8000-000000000022', 'bulk_updates.application_date', 'Report application dates through the typed bulk update pipeline'),
  ('30000000-0000-4000-8000-000000000023', 'operational_exports.create', 'Create on-demand operational exports');--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000004', "id" FROM "permissions"
WHERE "code" IN ('bulk_updates.dispensation_date', 'bulk_updates.read', 'operational_exports.create')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000005', "id" FROM "permissions"
WHERE "code" IN ('bulk_updates.application_date', 'bulk_updates.read', 'operational_exports.create')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "id", '30000000-0000-4000-8000-000000000023' FROM "roles"
WHERE "code" = 'MTD_ADMIN'
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "role_permissions" WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "code" IN ('application_site.assign', 'dispensing.register', 'attachments.upload', 'attachments.read')
);--> statement-breakpoint
DELETE FROM "permissions" WHERE "code" IN ('application_site.assign', 'dispensing.register', 'attachments.upload', 'attachments.read');
