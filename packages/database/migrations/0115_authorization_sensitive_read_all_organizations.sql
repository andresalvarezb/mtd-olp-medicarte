-- Patient identifiers and dosage are available in every supported organization
-- to active roles that already have general authorization read access.
-- This includes existing custom roles; new role grants remain configurable and
-- auditable through role access management.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT r."id", sensitive."id"
FROM "roles" r
JOIN "role_organization_scopes" ros
  ON ros."role_id" = r."id"
JOIN "organizations" o
  ON o."id" = ros."organization_id"
JOIN "role_permissions" existing_read
  ON existing_read."role_id" = r."id"
JOIN "permissions" read_permission
  ON read_permission."id" = existing_read."permission_id"
JOIN "permissions" sensitive
  ON sensitive."code" = 'authorizations.read_sensitive'
WHERE r."active" = true
  AND o."code" IN ('MTD', 'MEDICARTE', 'OLP', 'COMPENSAR')
  AND read_permission."code" = 'authorizations.read'
ON CONFLICT DO NOTHING;
