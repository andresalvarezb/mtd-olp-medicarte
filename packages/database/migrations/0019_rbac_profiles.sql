-- Perfiles de acceso explícitos. La autoridad continúa siendo la asignación
-- usuario + organización + rol; no se crean contraseñas ni usuarios aquí.
INSERT INTO "roles" ("id", "code", "name") VALUES
  ('20000000-0000-4000-8000-000000000007', 'MTD_GENERAL', 'MTD General'),
  ('20000000-0000-4000-8000-000000000008', 'MTD_AUDITORIA', 'MTD Auditoría')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('30000000-0000-4000-8000-000000000031', 'dashboard.read', 'View executive summary indicators'),
  ('30000000-0000-4000-8000-000000000032', 'audit.read', 'Read audit reviews and findings'),
  ('30000000-0000-4000-8000-000000000033', 'audit.write', 'Perform audit workflow decisions'),
  ('30000000-0000-4000-8000-000000000034', 'consolidated.read', 'View consolidated information'),
  ('30000000-0000-4000-8000-000000000035', 'view.dashboard', 'Open executive summary'),
  ('30000000-0000-4000-8000-000000000036', 'view.authorizations', 'Open authorizations'),
  ('30000000-0000-4000-8000-000000000037', 'view.mipres', 'Open MIPRES directions'),
  ('30000000-0000-4000-8000-000000000038', 'view.available', 'Open ready-to-dispense'),
  ('30000000-0000-4000-8000-000000000039', 'view.application', 'Open application sites'),
  ('30000000-0000-4000-8000-000000000040', 'view.logistics', 'Open OLP logistics'),
  ('30000000-0000-4000-8000-000000000041', 'view.supports', 'Open supports'),
  ('30000000-0000-4000-8000-000000000042', 'view.audit', 'Open audit'),
  ('30000000-0000-4000-8000-000000000043', 'view.notifications', 'Open notifications'),
  ('30000000-0000-4000-8000-000000000044', 'view.consolidated', 'Open consolidated'),
  ('30000000-0000-4000-8000-000000000045', 'view.failures', 'Open recoverable failures'),
  ('30000000-0000-4000-8000-000000000046', 'view.tariff', 'Open tariff annex'),
  ('30000000-0000-4000-8000-000000000047', 'view.admin', 'Open administration')
ON CONFLICT ("code") DO NOTHING;

-- El administrador de Foundation conserva acceso total, incluso a permisos
-- añadidos por migraciones posteriores.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_ADMIN' ON CONFLICT DO NOTHING;

-- Los roles MTD nuevos viven en la organización MTD y no reciben permisos de
-- escritura fuera de Auditoría (mtd-general no recibe ninguno).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_GENERAL'
  AND p."code" IN (
    'authorizations.read', 'application_site.read', 'exports.create',
    'operational_exports.create', 'consolidated.read'
  ) ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_AUDITORIA'
  AND p."code" IN (
    'dashboard.read', 'authorizations.read', 'audit.read', 'audit.write',
    'audit.start', 'audit.reject', 'audit.approve', 'exports.create',
    'consolidated.read'
  ) ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_OPERATOR' AND p."code" = 'audit.write'
ON CONFLICT DO NOTHING;

-- Permisos de navegación, separados de los permisos de acción.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR')
  AND p."code" LIKE 'view.%' ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'COMPENSAR_VIEWER'
  AND p."code" IN ('view.dashboard', 'view.authorizations', 'view.consolidated') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'OLP_OPERATOR'
  AND p."code" IN ('view.available', 'view.logistics', 'view.consolidated') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MEDICARTE_OPERATOR'
  AND p."code" IN ('view.available', 'view.application', 'view.supports', 'view.consolidated') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_GENERAL'
  AND p."code" IN ('view.dashboard', 'view.mipres', 'view.available', 'view.application', 'view.logistics', 'view.supports', 'view.consolidated') ON CONFLICT DO NOTHING;
DELETE FROM "role_permissions"
WHERE "role_id" = (SELECT "id" FROM "roles" WHERE "code" = 'MTD_GENERAL')
  AND "permission_id" = (SELECT "id" FROM "permissions" WHERE "code" = 'view.dashboard');
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_AUDITORIA'
  AND p."code" IN ('view.dashboard', 'view.authorizations', 'view.audit', 'view.consolidated') ON CONFLICT DO NOTHING;

-- El resumen es una capacidad explícita. OLP y Medicarte no la reciben.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" IN ('MTD_ADMIN', 'MTD_OPERATOR', 'COMPENSAR_VIEWER', 'READ_ONLY')
  AND p."code" = 'dashboard.read' ON CONFLICT DO NOTHING;
