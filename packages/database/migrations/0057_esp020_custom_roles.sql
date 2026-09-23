-- ESP-020: custom role lifecycle and organization scopes.
-- Existing roles remain active and receive their approved organization scopes.

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "role_organization_scopes" (
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "role_organization_scopes_pk" PRIMARY KEY ("role_id", "organization_id")
);

CREATE INDEX IF NOT EXISTS "role_organization_scopes_organization_idx"
  ON "role_organization_scopes" ("organization_id");

INSERT INTO "role_organization_scopes" ("role_id", "organization_id")
SELECT r.id, o.id
FROM "roles" r
JOIN "organizations" o ON o.code = 'MTD'
WHERE r.code IN ('MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_organization_scopes" ("role_id", "organization_id")
SELECT r.id, o.id
FROM "roles" r
JOIN "organizations" o ON o.code = 'MEDICARTE'
WHERE r.code IN ('MEDICARTE_OPERATOR', 'READ_ONLY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_organization_scopes" ("role_id", "organization_id")
SELECT r.id, o.id
FROM "roles" r
JOIN "organizations" o ON o.code = 'OLP'
WHERE r.code IN ('OLP_OPERATOR', 'READ_ONLY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_organization_scopes" ("role_id", "organization_id")
SELECT r.id, o.id
FROM "roles" r
JOIN "organizations" o ON o.code = 'COMPENSAR'
WHERE r.code IN ('COMPENSAR_VIEWER', 'READ_ONLY')
ON CONFLICT DO NOTHING;
