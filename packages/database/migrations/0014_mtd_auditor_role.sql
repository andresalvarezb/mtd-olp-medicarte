-- Rol MTD con acceso exclusivo a la revision y al visto bueno de soportes.
INSERT INTO "roles" ("id", "code", "name") VALUES
  ('20000000-0000-4000-8000-000000000007', 'MTD_AUDITOR', 'MTD auditor')
ON CONFLICT ("code") DO NOTHING;

-- Registrar hallazgos es una capacidad distinta a iniciar una revision.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000025', 'audit.findings.create', 'Record findings for an in-progress audit review')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR')
  AND p."code" = 'audit.findings.create'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_AUDITOR'
  AND p."code" IN (
    'authorizations.read',
    'authorizations.read_sensitive',
    'audit.start',
    'audit.approve'
  )
ON CONFLICT DO NOTHING;
