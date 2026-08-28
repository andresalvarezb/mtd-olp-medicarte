CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "oidc_subject" varchar(255) NOT NULL UNIQUE,
  "email" varchar(320) NOT NULL,
  "display_name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(80) NOT NULL UNIQUE,
  "name" varchar(160) NOT NULL
);

CREATE TABLE "permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(120) NOT NULL UNIQUE,
  "description" text NOT NULL
);

CREATE TABLE "role_permissions" (
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE RESTRICT,
  "permission_id" uuid NOT NULL REFERENCES "permissions"("id") ON DELETE RESTRICT,
  CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id", "permission_id")
);

CREATE TABLE "user_organization_roles" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE RESTRICT,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "user_organization_roles_pk" PRIMARY KEY("user_id", "organization_id", "role_id")
);

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  "actor_type" varchar(30) NOT NULL,
  "actor_id" uuid,
  "organization_id" uuid,
  "action" varchar(120) NOT NULL,
  "resource_type" varchar(120) NOT NULL,
  "resource_id" varchar(255) NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "correlation_id" uuid NOT NULL,
  "request_id" varchar(255),
  "ip_address" varchar(64),
  "user_agent" text,
  "result" varchar(40) NOT NULL
);
CREATE INDEX "audit_events_resource_idx" ON "audit_events" ("resource_type", "resource_id");

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TABLE "outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(120) NOT NULL,
  "version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" uuid NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(200) NOT NULL,
  "status" varchar(30) DEFAULT 'PENDING' NOT NULL CHECK ("status" IN ('PENDING', 'DISPATCHED', 'PROCESSED', 'FAILED')),
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "dispatched_at" timestamptz,
  "processed_at" timestamptz,
  "last_error" text
);
CREATE UNIQUE INDEX "outbox_events_idempotency_key_idx" ON "outbox_events" ("idempotency_key");
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events" ("status", "available_at");

CREATE TABLE "idempotency_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" varchar(120) NOT NULL,
  "key" varchar(200) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status_code" integer NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "idempotency_records_scope_key_idx" ON "idempotency_records" ("scope", "key");

CREATE TABLE "job_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "queue" varchar(120) NOT NULL,
  "job_name" varchar(120) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "result" jsonb NOT NULL,
  "correlation_id" uuid NOT NULL,
  "completed_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "job_results_queue_idempotency_idx" ON "job_results" ("queue", "idempotency_key");

INSERT INTO "organizations" ("id", "code", "name") VALUES
  ('10000000-0000-4000-8000-000000000001', 'MTD', 'MTD'),
  ('10000000-0000-4000-8000-000000000002', 'COMPENSAR', 'Compensar'),
  ('10000000-0000-4000-8000-000000000003', 'OLP', 'OLP'),
  ('10000000-0000-4000-8000-000000000004', 'MEDICARTE', 'Medicarte');

INSERT INTO "roles" ("id", "code", "name") VALUES
  ('20000000-0000-4000-8000-000000000001', 'MTD_ADMIN', 'MTD administrator'),
  ('20000000-0000-4000-8000-000000000002', 'MTD_OPERATOR', 'MTD operator'),
  ('20000000-0000-4000-8000-000000000003', 'COMPENSAR_VIEWER', 'Compensar viewer'),
  ('20000000-0000-4000-8000-000000000004', 'OLP_OPERATOR', 'OLP operator'),
  ('20000000-0000-4000-8000-000000000005', 'MEDICARTE_OPERATOR', 'Medicarte operator'),
  ('20000000-0000-4000-8000-000000000006', 'READ_ONLY', 'Read only');

INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000001', 'platform.foundation.execute', 'Execute the non-production foundation probe'),
  ('30000000-0000-4000-8000-000000000002', 'authorizations.read', 'Read authorizations within organization scope'),
  ('30000000-0000-4000-8000-000000000003', 'authorizations.read_sensitive', 'Read sensitive authorization fields'),
  ('30000000-0000-4000-8000-000000000004', 'imports.create', 'Create imports'),
  ('30000000-0000-4000-8000-000000000005', 'imports.confirm', 'Confirm imports'),
  ('30000000-0000-4000-8000-000000000006', 'mipres.recheck', 'Request a MIPRES recheck'),
  ('30000000-0000-4000-8000-000000000007', 'application_site.assign', 'Assign an application site'),
  ('30000000-0000-4000-8000-000000000008', 'application_site.read', 'Read an application site'),
  ('30000000-0000-4000-8000-000000000009', 'dispensing.register', 'Register dispensing'),
  ('30000000-0000-4000-8000-000000000010', 'attachments.upload', 'Upload attachments'),
  ('30000000-0000-4000-8000-000000000011', 'attachments.read', 'Read attachments'),
  ('30000000-0000-4000-8000-000000000012', 'audit.start', 'Start an audit'),
  ('30000000-0000-4000-8000-000000000013', 'audit.reject', 'Reject an audit'),
  ('30000000-0000-4000-8000-000000000014', 'audit.approve', 'Approve an audit'),
  ('30000000-0000-4000-8000-000000000015', 'exports.create', 'Create on-demand exports'),
  ('30000000-0000-4000-8000-000000000016', 'users.manage', 'Manage users and access'),
  ('30000000-0000-4000-8000-000000000017', 'platform.jobs.manage', 'Inspect and retry exhausted platform jobs');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000001', "id" FROM "permissions"
WHERE "code" NOT IN ('application_site.assign', 'dispensing.register');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000002', "id" FROM "permissions"
WHERE "code" IN ('imports.create', 'imports.confirm', 'authorizations.read', 'authorizations.read_sensitive', 'mipres.recheck', 'application_site.read', 'attachments.upload', 'attachments.read', 'audit.start', 'audit.reject', 'audit.approve', 'exports.create');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000003', "id" FROM "permissions" WHERE "code" = 'authorizations.read';

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000004', "id" FROM "permissions" WHERE "code" IN ('authorizations.read', 'application_site.read');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000005', "id" FROM "permissions"
WHERE "code" IN ('authorizations.read', 'application_site.assign', 'application_site.read', 'dispensing.register', 'attachments.upload', 'attachments.read');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT '20000000-0000-4000-8000-000000000006', "id" FROM "permissions" WHERE "code" = 'authorizations.read';

INSERT INTO "users" ("id", "oidc_subject", "email", "display_name", "active") VALUES
  ('40000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'admin@example.test', 'Foundation Admin', true),
  ('40000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'olp@example.test', 'OLP Operator', true),
  ('40000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'suspended@example.test', 'Suspended User', false);

INSERT INTO "user_organization_roles" ("user_id", "organization_id", "role_id") VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000006'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006');
