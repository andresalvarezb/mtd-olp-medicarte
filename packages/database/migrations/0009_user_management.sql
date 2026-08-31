CREATE TABLE "pending_user_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "oidc_subject" varchar(255) NOT NULL,
  "email" varchar(320) NOT NULL,
  "display_name" varchar(160),
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid
);--> statement-breakpoint
ALTER TABLE "pending_user_requests" ADD CONSTRAINT "pending_user_requests_oidc_subject_unique" UNIQUE("oidc_subject");--> statement-breakpoint
ALTER TABLE "pending_user_requests" ADD CONSTRAINT "pending_user_requests_status_check" CHECK ("pending_user_requests"."status" IN ('PENDING', 'APPROVED', 'REJECTED'));--> statement-breakpoint
CREATE INDEX "pending_user_requests_status_idx" ON "pending_user_requests" ("status");