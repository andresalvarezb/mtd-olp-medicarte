-- ESP-015: data authorization by dispensing point. Independent of RBAC.
-- No Medicarte operator backfill: empty scope until MTD_ADMIN grants points.

INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'operational_scopes.read', 'Read operational point scope grants'),
  (gen_random_uuid(), 'operational_scopes.manage', 'Grant and revoke operational point scopes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MTD_ADMIN', 'MTD_AUDITORIA')
  AND p.code = 'operational_scopes.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'MTD_ADMIN'
  AND p.code = 'operational_scopes.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE "user_point_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "dispensing_point_id" uuid NOT NULL REFERENCES "dispensing_points"("id") ON DELETE RESTRICT,
  "granted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "granted_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz,
  "revoked_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "user_point_scopes_revoked_check" CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "user_point_scopes_active_uniq"
  ON "user_point_scopes" ("user_id", "dispensing_point_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "user_point_scopes_user_active_idx"
  ON "user_point_scopes" ("user_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "user_point_scopes_point_active_idx"
  ON "user_point_scopes" ("dispensing_point_id")
  WHERE "revoked_at" IS NULL;
