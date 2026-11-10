-- Enable authorization search and sensitive patient fields for every active
-- role scoped to a supported organization. Both permissions are necessary for
-- every user in those roles to access patient searches and details.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT r."id", p."id"
FROM "roles" r
JOIN "role_organization_scopes" ros
  ON ros."role_id" = r."id"
JOIN "organizations" o
  ON o."id" = ros."organization_id"
JOIN "permissions" p
  ON p."code" IN ('authorizations.read', 'authorizations.read_sensitive')
WHERE r."active" = true
  AND o."code" IN ('MTD', 'MEDICARTE', 'OLP', 'COMPENSAR')
ON CONFLICT DO NOTHING;
