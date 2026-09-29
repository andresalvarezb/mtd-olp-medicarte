-- COMPENSAR_VIEWER
-- =================
--
-- Perfil observador del proceso.
--
-- Puede:
--   - Dashboard
--   - Consultar autorizaciones
--   - Consultar disponibilidad
--   - Consultar órdenes de compra
--
-- No puede ejecutar ninguna mutación operacional.

-- Asegurar permisos de lectura requeridos.
INSERT INTO role_permissions (
  role_id,
  permission_id
)
SELECT
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE
  r.code = 'COMPENSAR_VIEWER'
  AND p.code IN (
    'analytics.read',
    'authorizations.read',
    'inventory.read',
    'purchase_orders.read',

    -- Compatibilidad con navegación histórica.
    'dashboard.read',
    'view.dashboard',
    'view.authorizations',
    'view.available',
    'view.purchase_orders'
  )
ON CONFLICT DO NOTHING;


-- Hardening:
-- el rol COMPENSAR_VIEWER queda limitado estrictamente
-- a capacidades de lectura definidas arriba.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE
  rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'COMPENSAR_VIEWER'
  AND p.code NOT IN (
    'analytics.read',
    'authorizations.read',
    'inventory.read',
    'purchase_orders.read',
    'dashboard.read',
    'view.dashboard',
    'view.authorizations',
    'view.available',
    'view.purchase_orders'
  );
