INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('OLP_OPERATOR', 'MEDICARTE_OPERATOR')
  AND p."code" = 'authorizations.read_sensitive'
ON CONFLICT DO NOTHING;
