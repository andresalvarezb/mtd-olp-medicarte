-- ESP-019: Operación programada y alertamiento controlado de reconciliación.
-- PostgreSQL remains the durable source of truth and authority for policies,
-- scheduled executions, leases, fencing, and notifications.

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'reconciliation_operations.read', 'Read reconciliation policies and execution history'),
  (gen_random_uuid(), 'reconciliation_operations.manage', 'Manage reconciliation policies and trigger scheduled operations'),
  (gen_random_uuid(), 'reconciliation_notifications.read', 'Read reconciliation in-app operational notifications')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA', 'MTD_OPERATOR', 'MTD_GENERAL', 'READ_ONLY')
  AND p.code = 'reconciliation_operations.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'MTD_ADMIN'
  AND p.code = 'reconciliation_operations.manage'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA', 'MTD_OPERATOR', 'MTD_GENERAL', 'READ_ONLY')
  AND p.code = 'reconciliation_notifications.read'
ON CONFLICT DO NOTHING;

CREATE TABLE "reconciliation_operation_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "enabled" boolean DEFAULT false NOT NULL,
  "cadence" varchar(20) DEFAULT 'DAILY' NOT NULL,
  "timezone" varchar(80) DEFAULT 'America/Bogota' NOT NULL,
  "local_time" varchar(10) DEFAULT '02:00',
  "weekday" integer,
  "domains" jsonb,
  "planning_period_scope" varchar(40),
  "severity_alert_threshold" varchar(20) DEFAULT 'ERROR' NOT NULL,
  "notify_on_recovery" boolean DEFAULT true NOT NULL,
  "notify_on_technical_failure" boolean DEFAULT true NOT NULL,
  "next_run_at" timestamptz,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reconciliation_operation_policies_tenant_unique" UNIQUE ("tenant_id"),
  CONSTRAINT "reconciliation_operation_policies_cadence_check" CHECK ("cadence" IN ('DAILY', 'WEEKLY', 'MANUAL')),
  CONSTRAINT "reconciliation_operation_policies_threshold_check" CHECK ("severity_alert_threshold" IN ('CRITICAL', 'ERROR', 'WARNING', 'NONE')),
  CONSTRAINT "reconciliation_operation_policies_weekday_check" CHECK ("weekday" IS NULL OR ("weekday" >= 1 AND "weekday" <= 7))
);

CREATE INDEX "reconciliation_operation_policies_tenant_enabled_idx"
  ON "reconciliation_operation_policies" ("tenant_id", "enabled");

CREATE TABLE "reconciliation_operation_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "policy_id" uuid REFERENCES "reconciliation_operation_policies"("id") ON DELETE SET NULL,
  "trigger_type" varchar(20) DEFAULT 'SCHEDULED' NOT NULL,
  "scheduled_for" timestamptz,
  "claimed_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "claim_token" varchar(100),
  "claim_generation" integer DEFAULT 0 NOT NULL,
  "lease_expires_at" timestamptz,
  "last_error_code" varchar(80),
  "last_error_message" text,
  "missed_occurrences_count" integer DEFAULT 0 NOT NULL,
  "skip_reason" varchar(80),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reconciliation_operation_executions_scheduled_unique" UNIQUE ("tenant_id", "policy_id", "scheduled_for"),
  CONSTRAINT "reconciliation_operation_executions_trigger_check" CHECK ("trigger_type" IN ('MANUAL', 'SCHEDULED', 'RETRY')),
  CONSTRAINT "reconciliation_operation_executions_status_check" CHECK ("status" IN ('PENDING', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'))
);

CREATE INDEX "reconciliation_operation_executions_tenant_status_idx"
  ON "reconciliation_operation_executions" ("tenant_id", "status");

CREATE INDEX "reconciliation_operation_executions_lease_idx"
  ON "reconciliation_operation_executions" ("lease_expires_at")
  WHERE "status" IN ('CLAIMED', 'RUNNING');

ALTER TABLE "reconciliation_runs"
  ADD COLUMN "operation_execution_id" uuid REFERENCES "reconciliation_operation_executions"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "reconciliation_runs_operation_execution_unique"
  ON "reconciliation_runs" ("operation_execution_id")
  WHERE "operation_execution_id" IS NOT NULL;

CREATE TABLE "reconciliation_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "execution_id" uuid REFERENCES "reconciliation_operation_executions"("id") ON DELETE SET NULL,
  "reconciliation_run_id" uuid REFERENCES "reconciliation_runs"("id") ON DELETE SET NULL,
  "notification_type" varchar(40) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "dedup_key" varchar(200) NOT NULL,
  "status" varchar(20) DEFAULT 'SENT' NOT NULL,
  "channel" varchar(20) DEFAULT 'IN_APP' NOT NULL,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "read_at" timestamptz,
  "sent_at" timestamptz,
  "last_error_code" varchar(80),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reconciliation_notifications_dedup_unique" UNIQUE ("dedup_key"),
  CONSTRAINT "reconciliation_notifications_type_check" CHECK ("notification_type" IN ('RECONCILIATION_CRITICAL', 'RECONCILIATION_ERROR', 'RECONCILIATION_WARNING', 'RECONCILIATION_TECHNICAL_FAILURE', 'RECONCILIATION_RECOVERY', 'RISK_REVIEW_OVERDUE')),
  CONSTRAINT "reconciliation_notifications_severity_check" CHECK ("severity" IN ('CRITICAL', 'ERROR', 'WARNING', 'INFO')),
  CONSTRAINT "reconciliation_notifications_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED')),
  CONSTRAINT "reconciliation_notifications_channel_check" CHECK ("channel" IN ('IN_APP'))
);

CREATE INDEX "reconciliation_notifications_tenant_created_idx"
  ON "reconciliation_notifications" ("tenant_id", "created_at" DESC);

CREATE INDEX "reconciliation_notifications_tenant_unread_idx"
  ON "reconciliation_notifications" ("tenant_id")
  WHERE "read_at" IS NULL;
