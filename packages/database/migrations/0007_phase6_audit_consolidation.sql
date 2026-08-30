CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_review_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_item_id" uuid NOT NULL,
	"review_number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'IN_REVIEW' NOT NULL,
	"observations" text,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_reviews_status_check" CHECK ("audit_reviews"."status" IN ('IN_REVIEW', 'APPROVED', 'REJECTED')),
	CONSTRAINT "audit_reviews_review_number_check" CHECK ("audit_reviews"."review_number" > 0),
	CONSTRAINT "audit_reviews_decision_requires_fields_check" CHECK ("audit_reviews"."status" = 'IN_REVIEW' OR ("audit_reviews"."decided_by" IS NOT NULL AND "audit_reviews"."decided_at" IS NOT NULL)),
	CONSTRAINT "audit_reviews_reject_requires_observations_check" CHECK ("audit_reviews"."status" <> 'REJECTED' OR "audit_reviews"."observations" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "authorization_items" ADD COLUMN "admission_status" varchar(20) DEFAULT 'NOT_READY' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "authorization_items"
    WHERE "audit_status" = 'APPROVED' AND "operation_status" <> 'DISPENSED'
  ) THEN
    RAISE EXCEPTION 'Fase 6 migration blocked: historical APPROVED items without DISPENSED require explicit human reconciliation';
  END IF;
END $$;--> statement-breakpoint
UPDATE "authorization_items" SET "admission_status" = 'READY' WHERE "audit_status" = 'APPROVED';--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_review_id_audit_reviews_id_fk" FOREIGN KEY ("audit_review_id") REFERENCES "public"."audit_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_authorization_item_id_authorization_items_id_fk" FOREIGN KEY ("authorization_item_id") REFERENCES "public"."authorization_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_findings_review_idx" ON "audit_findings" USING btree ("audit_review_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_reviews_item_number_idx" ON "audit_reviews" USING btree ("authorization_item_id","review_number");--> statement-breakpoint
CREATE INDEX "audit_reviews_item_status_idx" ON "audit_reviews" USING btree ("authorization_item_id","status");--> statement-breakpoint
CREATE INDEX "authorization_items_audit_status_idx" ON "authorization_items" USING btree ("audit_status","created_at","id");--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_admission_status_check" CHECK ("authorization_items"."admission_status" IN ('NOT_READY', 'READY', 'HANDED_OFF', 'COMPLETED', 'ERROR'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_admission_ready_requires_approval_check" CHECK ("authorization_items"."admission_status" <> 'READY' OR "authorization_items"."audit_status" = 'APPROVED');