-- AC-FIN-001: MTD registra el recaudo de cuota moderadora.
-- MEDICARTE conserva solo acceso de consulta.
-- No se modifican autorizaciones ni eventos financieros existentes.

INSERT INTO permissions (
  code,
  description
)
VALUES (
  'moderator_fees.manage',
  'Register moderator fee collection on behalf of MTD'
)
ON CONFLICT (code) DO NOTHING;

-- Asignacion inicial conservadora:
-- MTD_ADMIN recibe la capacidad.
-- Otros roles MTD pueden recibirla posteriormente mediante RBAC.

INSERT INTO role_permissions (
  role_id,
  permission_id
)
SELECT
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'MTD_ADMIN'
  AND p.code = 'moderator_fees.manage'
ON CONFLICT DO NOTHING;
