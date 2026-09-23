-- OC operational flow.
--
-- MEDICARTE debe consultar la orden de compra para poder registrar
-- recepciones físicas contra sus líneas.
--
-- Esta migración NO concede ninguna acción de MTD ni OLP a Medicarte.
-- La recepción continúa protegida por medicarte_receipts.manage.

INSERT INTO "role_permissions" (
  "role_id",
  "permission_id"
)
SELECT
  r."id",
  p."id"
FROM
  "roles" r
CROSS JOIN
  "permissions" p
WHERE
  r."code" = 'MEDICARTE_OPERATOR'
  AND p."code" = 'purchase_orders.read'
ON CONFLICT DO NOTHING;
