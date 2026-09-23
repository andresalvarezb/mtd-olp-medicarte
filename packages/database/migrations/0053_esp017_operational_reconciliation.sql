-- ESP-017: operational reconciliation is a verification subsystem.
-- PostgreSQL remains the source of truth. These tables store runs and findings.
-- Rules never UPDATE/DELETE operational facts.

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'reconciliation.read', 'Read operational reconciliation runs and findings'),
  (gen_random_uuid(), 'reconciliation.run', 'Execute operational reconciliation runs')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA', 'MTD_OPERATOR', 'MTD_GENERAL', 'READ_ONLY')
  AND p.code = 'reconciliation.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA')
  AND p.code = 'reconciliation.run'
ON CONFLICT DO NOTHING;

CREATE TABLE "reconciliation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "scope" jsonb NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  "started_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "rules_version" varchar(40) NOT NULL,
  "total_rules" integer DEFAULT 0 NOT NULL,
  "passed_rules" integer DEFAULT 0 NOT NULL,
  "failed_rules" integer DEFAULT 0 NOT NULL,
  "not_applicable_rules" integer DEFAULT 0 NOT NULL,
  "critical_findings" integer DEFAULT 0 NOT NULL,
  "error_findings" integer DEFAULT 0 NOT NULL,
  "warning_findings" integer DEFAULT 0 NOT NULL,
  "info_findings" integer DEFAULT 0 NOT NULL,
  "generated_at" timestamptz,
  "duration_ms" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "reconciliation_runs_status_check"
    CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "reconciliation_runs_total_rules_check" CHECK ("total_rules" >= 0),
  CONSTRAINT "reconciliation_runs_passed_rules_check" CHECK ("passed_rules" >= 0),
  CONSTRAINT "reconciliation_runs_failed_rules_check" CHECK ("failed_rules" >= 0),
  CONSTRAINT "reconciliation_runs_not_applicable_rules_check" CHECK ("not_applicable_rules" >= 0),
  CONSTRAINT "reconciliation_runs_critical_findings_check" CHECK ("critical_findings" >= 0),
  CONSTRAINT "reconciliation_runs_error_findings_check" CHECK ("error_findings" >= 0),
  CONSTRAINT "reconciliation_runs_warning_findings_check" CHECK ("warning_findings" >= 0),
  CONSTRAINT "reconciliation_runs_info_findings_check" CHECK ("info_findings" >= 0)
);

CREATE INDEX "reconciliation_runs_tenant_started_idx"
  ON "reconciliation_runs" ("tenant_id", "started_at");
CREATE INDEX "reconciliation_runs_status_idx"
  ON "reconciliation_runs" ("tenant_id", "status", "started_at");

COMMENT ON TABLE "reconciliation_runs" IS
  'ESP-017 verification runs. FAILED means the engine could not finish, not that findings exist. A COMPLETED run may contain findings. Not a source of truth.';

CREATE TABLE "reconciliation_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reconciliation_run_id" uuid NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT,
  "rule_code" varchar(40) NOT NULL,
  "rule_version" varchar(40) NOT NULL,
  "category" varchar(20) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "domain" varchar(20) NOT NULL,
  "entity_type" varchar(80) NOT NULL,
  "entity_id" uuid,
  "related_entity_type" varchar(80),
  "related_entity_id" uuid,
  "dispensing_point_id" uuid,
  "planning_period_id" uuid,
  "commercial_code" varchar(255),
  "message" text NOT NULL,
  "evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "fingerprint" varchar(200) NOT NULL,
  "truncated" boolean DEFAULT false NOT NULL,
  "detected_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reconciliation_findings_run_rule_fingerprint_unique"
    UNIQUE ("reconciliation_run_id", "rule_code", "fingerprint"),
  CONSTRAINT "reconciliation_findings_category_check"
    CHECK ("category" IN ('INTEGRITY', 'CONSISTENCY', 'RECONCILIATION', 'OBSERVATION')),
  CONSTRAINT "reconciliation_findings_severity_check"
    CHECK ("severity" IN ('CRITICAL', 'ERROR', 'WARNING', 'INFO')),
  CONSTRAINT "reconciliation_findings_rule_code_check" CHECK (length(btrim("rule_code")) > 0),
  CONSTRAINT "reconciliation_findings_message_check" CHECK (length(btrim("message")) > 0)
);

CREATE INDEX "reconciliation_findings_run_severity_idx"
  ON "reconciliation_findings" ("reconciliation_run_id", "severity");
CREATE INDEX "reconciliation_findings_run_rule_idx"
  ON "reconciliation_findings" ("reconciliation_run_id", "rule_code");
CREATE INDEX "reconciliation_findings_run_domain_idx"
  ON "reconciliation_findings" ("reconciliation_run_id", "domain");

COMMENT ON TABLE "reconciliation_findings" IS
  'ESP-017 detected inconsistencies. Evidence prefers technical IDs. No auto-repair. No ACKNOWLEDGED/RESOLVED workflow.';
