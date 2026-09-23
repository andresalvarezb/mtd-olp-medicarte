-- ESP-018: governance of reconciliation findings.
-- PostgreSQL remains the source of truth. Issues do not repair operational data
-- and never rewrite ESP-017 run/finding severity.

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'reconciliation_issues.read', 'Read persistent reconciliation issues'),
  (gen_random_uuid(), 'reconciliation_issues.triage', 'Triage reconciliation issues (acknowledge, assign, resolve, accept-risk, reopen)'),
  (gen_random_uuid(), 'reconciliation_issues.comment', 'Comment on reconciliation issues')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA', 'MTD_OPERATOR', 'MTD_GENERAL', 'READ_ONLY')
  AND p.code = 'reconciliation_issues.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA')
  AND p.code = 'reconciliation_issues.triage'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA', 'MTD_OPERATOR')
  AND p.code = 'reconciliation_issues.comment'
ON CONFLICT DO NOTHING;

CREATE TABLE "reconciliation_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "rule_code" varchar(40) NOT NULL,
  "fingerprint" varchar(200) NOT NULL,
  "domain" varchar(20) NOT NULL,
  "category" varchar(20) NOT NULL,
  "status" varchar(20) DEFAULT 'OPEN' NOT NULL,
  "current_severity" varchar(20) NOT NULL,
  "max_severity_seen" varchar(20) NOT NULL,
  "first_seen_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "first_run_id" uuid NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT,
  "last_run_id" uuid NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT,
  "last_finding_id" uuid,
  "first_rule_version" varchar(40) NOT NULL,
  "last_rule_version" varchar(40) NOT NULL,
  "assigned_to_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "acknowledged_at" timestamptz,
  "acknowledged_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "resolved_at" timestamptz,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "resolution_code" varchar(40),
  "resolution_note" text,
  "accepted_risk_at" timestamptz,
  "accepted_risk_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "accepted_risk_reason" text,
  "accepted_risk_severity" varchar(20),
  "accepted_risk_rule_version" varchar(40),
  "risk_review_at" timestamptz,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reconciliation_issues_identity_unique"
    UNIQUE ("tenant_id", "rule_code", "fingerprint"),
  CONSTRAINT "reconciliation_issues_status_check"
    CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACCEPTED_RISK')),
  CONSTRAINT "reconciliation_issues_current_severity_check"
    CHECK ("current_severity" IN ('CRITICAL', 'ERROR', 'WARNING', 'INFO')),
  CONSTRAINT "reconciliation_issues_max_severity_check"
    CHECK ("max_severity_seen" IN ('CRITICAL', 'ERROR', 'WARNING', 'INFO')),
  CONSTRAINT "reconciliation_issues_accepted_severity_check"
    CHECK ("accepted_risk_severity" IS NULL OR "accepted_risk_severity" IN ('CRITICAL', 'ERROR', 'WARNING', 'INFO')),
  CONSTRAINT "reconciliation_issues_category_check"
    CHECK ("category" IN ('INTEGRITY', 'CONSISTENCY', 'RECONCILIATION', 'OBSERVATION')),
  CONSTRAINT "reconciliation_issues_resolution_code_check"
    CHECK ("resolution_code" IS NULL OR "resolution_code" IN (
      'DATA_CORRECTED', 'PROCESS_CORRECTED', 'RULE_UPDATED', 'NO_LONGER_APPLICABLE', 'OTHER'
    )),
  CONSTRAINT "reconciliation_issues_occurrence_check" CHECK ("occurrence_count" >= 1),
  CONSTRAINT "reconciliation_issues_version_check" CHECK ("version" >= 1),
  CONSTRAINT "reconciliation_issues_rule_code_check" CHECK (length(btrim("rule_code")) > 0),
  CONSTRAINT "reconciliation_issues_fingerprint_check" CHECK (length(btrim("fingerprint")) > 0)
);

CREATE INDEX "reconciliation_issues_tenant_status_idx"
  ON "reconciliation_issues" ("tenant_id", "status");
CREATE INDEX "reconciliation_issues_tenant_severity_idx"
  ON "reconciliation_issues" ("tenant_id", "current_severity");
CREATE INDEX "reconciliation_issues_tenant_assigned_idx"
  ON "reconciliation_issues" ("tenant_id", "assigned_to_user_id");
CREATE INDEX "reconciliation_issues_tenant_rule_idx"
  ON "reconciliation_issues" ("tenant_id", "rule_code");
CREATE INDEX "reconciliation_issues_tenant_last_seen_idx"
  ON "reconciliation_issues" ("tenant_id", "last_seen_at");

COMMENT ON TABLE "reconciliation_issues" IS
  'ESP-018 persistent identity of a reconciliation inconsistency. Governance truth only. Does not rewrite findings, run health, or operational facts.';

CREATE TABLE "reconciliation_issue_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issue_id" uuid NOT NULL REFERENCES "reconciliation_issues"("id") ON DELETE RESTRICT,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "event_type" varchar(40) NOT NULL,
  "from_status" varchar(20),
  "to_status" varchar(20),
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "reconciliation_run_id" uuid REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT,
  "finding_id" uuid,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reconciliation_issue_events_type_check"
    CHECK ("event_type" IN (
      'ISSUE_CREATED',
      'ISSUE_ACKNOWLEDGED',
      'ISSUE_ASSIGNED',
      'ISSUE_UNASSIGNED',
      'ISSUE_RESOLVED',
      'ISSUE_ACCEPTED_RISK',
      'ISSUE_REOPENED',
      'RISK_ACCEPTANCE_INVALIDATED',
      'ISSUE_MANUALLY_REOPENED'
    )),
  CONSTRAINT "reconciliation_issue_events_from_status_check"
    CHECK ("from_status" IS NULL OR "from_status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACCEPTED_RISK')),
  CONSTRAINT "reconciliation_issue_events_to_status_check"
    CHECK ("to_status" IS NULL OR "to_status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACCEPTED_RISK'))
);

CREATE INDEX "reconciliation_issue_events_issue_created_idx"
  ON "reconciliation_issue_events" ("issue_id", "created_at");

COMMENT ON TABLE "reconciliation_issue_events" IS
  'ESP-018 append-only governance timeline. REOPENED is an event, not a persisted status.';

CREATE TABLE "reconciliation_issue_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issue_id" uuid NOT NULL REFERENCES "reconciliation_issues"("id") ON DELETE RESTRICT,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "author_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "edited_at" timestamptz,
  CONSTRAINT "reconciliation_issue_comments_body_check"
    CHECK (length(btrim("body")) > 0 AND length("body") <= 2000)
);

CREATE INDEX "reconciliation_issue_comments_issue_created_idx"
  ON "reconciliation_issue_comments" ("issue_id", "created_at");

COMMENT ON TABLE "reconciliation_issue_comments" IS
  'ESP-018 append-only issue comments. Do not copy body into audit_events.';

ALTER TABLE "reconciliation_findings"
  ADD COLUMN "issue_id" uuid;

INSERT INTO "reconciliation_issues" (
  tenant_id, rule_code, fingerprint, domain, category, status,
  current_severity, max_severity_seen, first_seen_at, last_seen_at,
  occurrence_count, first_run_id, last_run_id, last_finding_id,
  first_rule_version, last_rule_version, version
)
SELECT
  r.tenant_id,
  f.rule_code,
  f.fingerprint,
  (array_agg(f.domain ORDER BY f.detected_at DESC, f.id DESC))[1],
  (array_agg(f.category ORDER BY f.detected_at DESC, f.id DESC))[1],
  'OPEN',
  (array_agg(f.severity ORDER BY f.detected_at DESC, f.id DESC))[1],
  (array_agg(f.severity ORDER BY CASE f.severity
     WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, f.id))[1],
  min(f.detected_at),
  max(f.detected_at),
  count(*)::int,
  (array_agg(f.reconciliation_run_id ORDER BY f.detected_at ASC, f.id ASC))[1],
  (array_agg(f.reconciliation_run_id ORDER BY f.detected_at DESC, f.id DESC))[1],
  (array_agg(f.id ORDER BY f.detected_at DESC, f.id DESC))[1],
  (array_agg(f.rule_version ORDER BY f.detected_at ASC, f.id ASC))[1],
  (array_agg(f.rule_version ORDER BY f.detected_at DESC, f.id DESC))[1],
  1
FROM reconciliation_findings f
JOIN reconciliation_runs r ON r.id = f.reconciliation_run_id
GROUP BY r.tenant_id, f.rule_code, f.fingerprint;

UPDATE reconciliation_findings f
SET issue_id = i.id
FROM reconciliation_runs r, reconciliation_issues i
WHERE r.id = f.reconciliation_run_id
  AND i.tenant_id = r.tenant_id
  AND i.rule_code = f.rule_code
  AND i.fingerprint = f.fingerprint;

INSERT INTO reconciliation_issue_events (issue_id, tenant_id, event_type, to_status, metadata_json)
SELECT id, tenant_id, 'ISSUE_CREATED', 'OPEN', jsonb_build_object('source', 'ESP-018_BACKFILL')
FROM reconciliation_issues;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM reconciliation_findings WHERE issue_id IS NULL) THEN
    RAISE EXCEPTION 'ESP-018 backfill left orphan reconciliation_findings';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM reconciliation_issues i
      LEFT JOIN (
        SELECT issue_id, count(*)::int AS n
          FROM reconciliation_findings
         GROUP BY issue_id
      ) f ON f.issue_id = i.id
     WHERE coalesce(f.n, 0) IS DISTINCT FROM i.occurrence_count
  ) THEN
    RAISE EXCEPTION 'ESP-018 backfill occurrence_count does not match findings';
  END IF;
END $$;

ALTER TABLE "reconciliation_findings"
  ALTER COLUMN "issue_id" SET NOT NULL;

ALTER TABLE "reconciliation_findings"
  ADD CONSTRAINT "reconciliation_findings_issue_fk"
    FOREIGN KEY ("issue_id") REFERENCES "reconciliation_issues"("id") ON DELETE RESTRICT;

CREATE INDEX "reconciliation_findings_issue_detected_idx"
  ON "reconciliation_findings" ("issue_id", "detected_at");

ALTER TABLE "reconciliation_issues"
  ADD CONSTRAINT "reconciliation_issues_last_finding_fk"
    FOREIGN KEY ("last_finding_id") REFERENCES "reconciliation_findings"("id") ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "reconciliation_issue_events"
  ADD CONSTRAINT "reconciliation_issue_events_finding_fk"
    FOREIGN KEY ("finding_id") REFERENCES "reconciliation_findings"("id") ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;
