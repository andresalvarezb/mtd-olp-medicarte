-- READ_ONLY puede consultar toda la operación, pero no administración ni
-- Anexo Tarifario. Los permisos de escritura no se asignan a este rol.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'view.imports', 'Open import history'),
  (gen_random_uuid(), 'view.purchase_orders', 'Open purchase order queue')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR', 'READ_ONLY')
  AND p."code" IN ('view.imports', 'view.purchase_orders')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'READ_ONLY'
  AND p."code" IN (
    'dashboard.read',
    'authorizations.read',
    'application_site.read',
    'audit.read',
    'consolidated.read',
    'bulk_updates.read',
    'view.dashboard',
    'view.authorizations',
    'view.imports',
    'view.mipres',
    'view.available',
    'view.application',
    'view.purchase_orders',
    'view.logistics',
    'view.supports',
    'view.audit',
    'view.consolidated',
    'view.failures'
  )
ON CONFLICT DO NOTHING;
