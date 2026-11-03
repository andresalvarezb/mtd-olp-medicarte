-- Fixture sintetico exclusivo de mtd_olp_medicarte_test.
-- Sin datos restaurados desde respaldo ni información de pacientes reales.
BEGIN;

INSERT INTO users (id, username, display_name, active, provenance)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'test-mtd-admin', 'Usuario de prueba MTD', true, 'TEST_FIXTURE'),
  ('a0000000-0000-4000-8000-000000000002', 'test-olp-operator', 'Usuario de prueba OLP', true, 'TEST_FIXTURE'),
  ('a0000000-0000-4000-8000-000000000003', 'test-medicarte-operator', 'Usuario de prueba MEDICARTE', true, 'TEST_FIXTURE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_organization_scopes (role_id, organization_id)
SELECT r.id, o.id
FROM roles r
JOIN organizations o ON (r.code, o.code) IN (
  ('MTD_ADMIN', 'MTD'),
  ('OLP_OPERATOR', 'OLP'),
  ('MEDICARTE_OPERATOR', 'MEDICARTE')
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (r.code, p.code) IN (
  ('MTD_ADMIN', 'authorizations.read'),
  ('MTD_ADMIN', 'moderator_fees.manage'),
  ('OLP_OPERATOR', 'purchase_orders.read'),
  ('MEDICARTE_OPERATOR', 'authorizations.read'),
  ('MEDICARTE_OPERATOR', 'inventory.read')
)
ON CONFLICT DO NOTHING;

INSERT INTO user_organization_roles (user_id, organization_id, role_id)
SELECT x.user_id::uuid, o.id, r.id
FROM (VALUES
  ('a0000000-0000-4000-8000-000000000001', 'MTD', 'MTD_ADMIN'),
  ('a0000000-0000-4000-8000-000000000002', 'OLP', 'OLP_OPERATOR'),
  ('a0000000-0000-4000-8000-000000000003', 'MEDICARTE', 'MEDICARTE_OPERATOR')
) AS x(user_id, organization_code, role_code)
JOIN organizations o ON o.code = x.organization_code
JOIN roles r ON r.code = x.role_code
ON CONFLICT DO NOTHING;

INSERT INTO dispensing_points (id, organization_id, code, name, created_by)
SELECT 'b0000000-0000-4000-8000-000000000001', id, 'TEST-PUNTO-001', 'Punto de prueba 001',
       'a0000000-0000-4000-8000-000000000001'
FROM organizations WHERE code = 'MEDICARTE'
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_point_scopes (id, user_id, dispensing_point_id, granted_by)
VALUES
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tariff_annex_products (id, codigo_producto, descripcion_generica, organization_id, created_by)
SELECT v.id::uuid, v.product_code, v.description, o.id, 'a0000000-0000-4000-8000-000000000001'
FROM (VALUES
  ('c0000000-0000-4000-8000-000000000001', 'TEST-MED-001', 'Medicamento sintetico de prueba 001'),
  ('c0000000-0000-4000-8000-000000000002', 'TEST-MED-002', 'Medicamento sintetico de prueba 002')
) AS v(id, product_code, description)
JOIN organizations o ON o.code = 'MTD'
ON CONFLICT (id) DO NOTHING;

INSERT INTO import_batches (
  id, organization_id, created_by, original_filename, mime_type, size_bytes,
  sha256, processor_version, status, total_rows, valid_rows, confirmed_rows,
  started_at, completed_at, confirmed_at
)
SELECT 'd0000000-0000-4000-8000-000000000001', o.id,
       'a0000000-0000-4000-8000-000000000001', 'synthetic-test-fixture.csv',
       'text/csv', 128, repeat('a', 64), 1, 'COMPLETED', 6, 6, 6,
       now(), now(), now()
FROM organizations o WHERE o.code = 'MTD'
ON CONFLICT (id) DO UPDATE SET
  total_rows = EXCLUDED.total_rows,
  valid_rows = EXCLUDED.valid_rows,
  confirmed_rows = EXCLUDED.confirmed_rows,
  status = EXCLUDED.status;

INSERT INTO authorization_items (
  id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
  source_status_normalized, enablement_status, coverage_type, direction_status,
  coverage_rule_version, created_from_batch_id
)
SELECT v.id::uuid, v.authorization_number, v.product_code,
       v.authorization_number || '|' || v.product_code,
       jsonb_build_object(
         'CODIGO_COMERCIAL', v.product_code,
         'NOMBRE_PACIENTE', 'Paciente sintetico de prueba',
         'TIPO_IDENTIFICACION', 'TEST',
         'IDENTIFICACION_PACIENTE', 'TEST-PERSON-' || v.person_suffix,
         'CANTIDAD', v.quantity,
         'VALOR_CUOTA_MODERADORA', '12500',
         'FECHA_FINAL_VIGENCIA', '2027-12-31'
       ),
       'AUTHORIZED', 'ENABLED', 'NO_PBS', 'NOT_APPLICABLE', 'TEST-RULE-1',
       'd0000000-0000-4000-8000-000000000001'
FROM (VALUES
  ('e0000000-0000-4000-8000-000000000001', 'TEST-AUTH-RESERVED-001', 'TEST-MED-001', 10, '001'),
  ('e0000000-0000-4000-8000-000000000002', 'TEST-AUTH-PARTIAL-001', 'TEST-MED-001', 10, '002'),
  ('e0000000-0000-4000-8000-000000000003', 'TEST-AUTH-COMPLETE-001', 'TEST-MED-001', 10, '003'),
  ('e0000000-0000-4000-8000-000000000004', 'TEST-AUTH-MULTI-001', 'TEST-MED-001', 10, '004'),
  ('e0000000-0000-4000-8000-000000000005', 'TEST-AUTH-MULTI-001', 'TEST-MED-002', 5, '005'),
  ('e0000000-0000-4000-8000-000000000006', 'TEST-AUTH-NO-RESERVATION-001', 'TEST-MED-002', 5, '006')
) AS v(id, authorization_number, product_code, quantity, person_suffix)
ON CONFLICT (id) DO NOTHING;

INSERT INTO authorization_item_organizations (authorization_item_id, organization_id)
SELECT a.id, o.id
FROM authorization_items a
JOIN organizations o ON o.code IN ('MTD', 'MEDICARTE')
WHERE a.id IN (
  'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004',
  'e0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000006'
)
ON CONFLICT DO NOTHING;

INSERT INTO purchase_orders (
  id, purchase_order_code, origin, order_type, status, issued_at, issued_by,
  olp_accepted_at, olp_accepted_by, olp_committed_date, created_by, updated_by
)
VALUES (
  'f0000000-0000-4000-8000-000000000001', 'TEST-PO-001', 'DIRECT_AUTHORIZATION',
  'STANDARD', 'RECEIVED', now(), 'a0000000-0000-4000-8000-000000000001',
  now(), 'a0000000-0000-4000-8000-000000000002', current_date,
  'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_lines (
  id, purchase_order_id, commercial_code, provenance, product_description,
  dispensing_point_id, requested_quantity, olp_managed_quantity, accepted_quantity,
  compensar_unit_rate_snapshot, tariff_snapshot_provenance, supplier_unit_cost
)
VALUES
  ('f0000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-000000000001', 'TEST-MED-001', 'DIRECT_AUTHORIZATION', 'Medicamento sintetico 001', 'b0000000-0000-4000-8000-000000000001', 40, 40, 40, 'TEST-RATE', 'LIVE_SNAPSHOT', '123.45'),
  ('f0000000-0000-4000-8000-000000000012', 'f0000000-0000-4000-8000-000000000001', 'TEST-MED-002', 'DIRECT_AUTHORIZATION', 'Medicamento sintetico 002', 'b0000000-0000-4000-8000-000000000001', 5, 5, 5, 'TEST-RATE', 'LIVE_SNAPSHOT', '234.56')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_authorization_sources (
  purchase_order_line_id, authorization_item_id, source_quantity_snapshot,
  provenance, evidence_at
)
VALUES
  ('f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000001', 10, 'DIRECT_AUTHORIZATION', now()),
  ('f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000002', 10, 'DIRECT_AUTHORIZATION', now()),
  ('f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003', 10, 'DIRECT_AUTHORIZATION', now()),
  ('f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000004', 10, 'DIRECT_AUTHORIZATION', now()),
  ('f0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000005', 5, 'DIRECT_AUTHORIZATION', now())
ON CONFLICT DO NOTHING;

INSERT INTO deliveries (
  id, purchase_order_id, supplier_reference, status, dispatched_at, dispatched_by,
  declared_dispatch_date, created_by, updated_by
)
VALUES (
  'f0000000-0000-4000-8000-000000000021', 'f0000000-0000-4000-8000-000000000001',
  'TEST-DISPATCH-001', 'RECEIVED', now(), 'a0000000-0000-4000-8000-000000000002',
  current_date, 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO delivery_lines (
  id, delivery_id, purchase_order_line_id, commercial_code, dispensing_point_id,
  quantity, lot_number, expiration_date
)
VALUES
  ('f0000000-0000-4000-8000-000000000031', 'f0000000-0000-4000-8000-000000000021', 'f0000000-0000-4000-8000-000000000011', 'TEST-MED-001', 'b0000000-0000-4000-8000-000000000001', 40, 'TEST-LOT-001', '2028-12-31'),
  ('f0000000-0000-4000-8000-000000000032', 'f0000000-0000-4000-8000-000000000021', 'f0000000-0000-4000-8000-000000000012', 'TEST-MED-002', 'b0000000-0000-4000-8000-000000000001', 5, 'TEST-LOT-002', '2028-12-31')
ON CONFLICT (id) DO NOTHING;

INSERT INTO receipts (id, delivery_id, status, conformity, received_at, confirmed_at, created_by, updated_by)
VALUES ('f0000000-0000-4000-8000-000000000041', 'f0000000-0000-4000-8000-000000000021', 'CONFIRMED', 'CONFORMING', now(), now(), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO receipt_lines (
  id, receipt_id, delivery_line_id, dispatched_quantity, received_quantity,
  accepted_quantity, rejected_quantity, shortage_quantity, expected_lot_number,
  expected_expiration_date, received_lot_number, received_expiration_date, conformity
)
VALUES
  ('f0000000-0000-4000-8000-000000000051', 'f0000000-0000-4000-8000-000000000041', 'f0000000-0000-4000-8000-000000000031', 40, 40, 40, 0, 0, 'TEST-LOT-001', '2028-12-31', 'TEST-LOT-001', '2028-12-31', 'CONFORMING'),
  ('f0000000-0000-4000-8000-000000000052', 'f0000000-0000-4000-8000-000000000041', 'f0000000-0000-4000-8000-000000000032', 5, 5, 5, 0, 0, 'TEST-LOT-002', '2028-12-31', 'TEST-LOT-002', '2028-12-31', 'CONFORMING')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_receipts (id, purchase_order_id, confirmed_by, observation)
VALUES ('f0000000-0000-4000-8000-000000000061', 'f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Recepcion sintetica TEST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_receipt_lines (id, receipt_id, purchase_order_line_id, outcome, received_quantity, lot_number, expiration_date)
VALUES
  ('f0000000-0000-4000-8000-000000000071', 'f0000000-0000-4000-8000-000000000061', 'f0000000-0000-4000-8000-000000000011', 'RECEIVED_COMPLETE', 40, 'TEST-LOT-001', '2028-12-31'),
  ('f0000000-0000-4000-8000-000000000072', 'f0000000-0000-4000-8000-000000000061', 'f0000000-0000-4000-8000-000000000012', 'RECEIVED_COMPLETE', 5, 'TEST-LOT-002', '2028-12-31')
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_lots (id, commercial_code, dispensing_point_id, lot_number, expiration_date)
VALUES
  ('f0000000-0000-4000-8000-000000000081', 'TEST-MED-001', 'b0000000-0000-4000-8000-000000000001', 'TEST-LOT-001', '2028-12-31'),
  ('f0000000-0000-4000-8000-000000000082', 'TEST-MED-002', 'b0000000-0000-4000-8000-000000000001', 'TEST-LOT-002', '2028-12-31')
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_movements (id, inventory_lot_id, movement_type, quantity_delta, source_type, source_id, occurred_at, created_by)
VALUES
  ('f0000000-0000-4000-8000-000000000091', 'f0000000-0000-4000-8000-000000000081', 'RECEIPT', 40, 'RECEIPT_LINE', 'f0000000-0000-4000-8000-000000000051', now(), 'a0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000092', 'f0000000-0000-4000-8000-000000000082', 'RECEIPT', 5, 'RECEIPT_LINE', 'f0000000-0000-4000-8000-000000000052', now(), 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_allocation_batches (
  id, organization_id, source, status, total_rows, valid_rows, allocated_quantity,
  correlation_id, created_by, confirmed_by, confirmed_at
)
SELECT 'f0000000-0000-4000-8000-000000000101', id, 'UI', 'CONFIRMED', 5, 5, 45,
       'f0000000-0000-4000-8000-000000000102',
       'a0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000001', now()
FROM organizations WHERE code = 'MTD'
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_authorization_allocations (
  id, batch_id, organization_id, authorization_item_id, purchase_order_id,
  commercial_code, dispensing_point_id, allocated_quantity, consumed_quantity,
  status, authorization_version, created_by, updated_by
)
SELECT v.id::uuid, 'f0000000-0000-4000-8000-000000000101', o.id,
       v.authorization_item_id::uuid, 'f0000000-0000-4000-8000-000000000001',
       v.product_code, 'b0000000-0000-4000-8000-000000000001', v.allocated_quantity,
       v.consumed_quantity, v.status, 1,
       'a0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000001'
FROM (VALUES
  ('f0000000-0000-4000-8000-000000000111', 'e0000000-0000-4000-8000-000000000001', 'TEST-MED-001', 10, 0, 'ALLOCATED'),
  ('f0000000-0000-4000-8000-000000000112', 'e0000000-0000-4000-8000-000000000002', 'TEST-MED-001', 10, 3, 'PARTIALLY_CONSUMED'),
  ('f0000000-0000-4000-8000-000000000113', 'e0000000-0000-4000-8000-000000000003', 'TEST-MED-001', 10, 10, 'CONSUMED'),
  ('f0000000-0000-4000-8000-000000000114', 'e0000000-0000-4000-8000-000000000004', 'TEST-MED-001', 10, 0, 'ALLOCATED'),
  ('f0000000-0000-4000-8000-000000000115', 'e0000000-0000-4000-8000-000000000005', 'TEST-MED-002', 5, 0, 'ALLOCATED')
) AS v(id, authorization_item_id, product_code, allocated_quantity, consumed_quantity, status)
JOIN organizations o ON o.code = 'MTD'
ON CONFLICT (id) DO NOTHING;

INSERT INTO authorization_fulfillments (
  id, organization_id, authorization_item_id, fulfillment_type, effective_date,
  quantity, source, confirmed_by
)
SELECT v.id::uuid, o.id, v.authorization_item_id::uuid, v.fulfillment_type,
       current_date - 1, v.quantity, 'UI', 'a0000000-0000-4000-8000-000000000003'
FROM (VALUES
  ('f0000000-0000-4000-8000-000000000121', 'e0000000-0000-4000-8000-000000000002', 'DELIVERY', 3),
  ('f0000000-0000-4000-8000-000000000122', 'e0000000-0000-4000-8000-000000000003', 'APPLICATION', 10)
) AS v(id, authorization_item_id, fulfillment_type, quantity)
JOIN organizations o ON o.code = 'MEDICARTE'
ON CONFLICT (id) DO NOTHING;

INSERT INTO authorization_fulfillment_lines (
  id, fulfillment_id, inventory_authorization_allocation_id, purchase_order_id,
  inventory_lot_id, commercial_code, dispensing_point_id, lot_number,
  expiration_date, quantity
)
VALUES
  ('f0000000-0000-4000-8000-000000000131', 'f0000000-0000-4000-8000-000000000121', 'f0000000-0000-4000-8000-000000000112', 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000081', 'TEST-MED-001', 'b0000000-0000-4000-8000-000000000001', 'TEST-LOT-001', '2028-12-31', 3),
  ('f0000000-0000-4000-8000-000000000132', 'f0000000-0000-4000-8000-000000000122', 'f0000000-0000-4000-8000-000000000113', 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000081', 'TEST-MED-001', 'b0000000-0000-4000-8000-000000000001', 'TEST-LOT-001', '2028-12-31', 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_movements (id, inventory_lot_id, movement_type, quantity_delta, source_type, source_id, occurred_at, created_by)
VALUES
  ('f0000000-0000-4000-8000-000000000141', 'f0000000-0000-4000-8000-000000000081', 'FULFILLMENT_DELIVERY', -3, 'AUTHORIZATION_FULFILLMENT', 'f0000000-0000-4000-8000-000000000121', now(), 'a0000000-0000-4000-8000-000000000003'),
  ('f0000000-0000-4000-8000-000000000142', 'f0000000-0000-4000-8000-000000000081', 'FULFILLMENT_APPLICATION', -10, 'AUTHORIZATION_FULFILLMENT', 'f0000000-0000-4000-8000-000000000122', now(), 'a0000000-0000-4000-8000-000000000003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO authorization_moderator_fee_events (
  id, authorization_item_id, version, status, amount_cop, collected_at,
  registered_by, organization_id, correlation_id, idempotency_key
)
SELECT v.id::uuid, v.authorization_item_id::uuid, 1, 'COLLECTED', 12500,
       now() - interval '1 day', 'a0000000-0000-4000-8000-000000000001', o.id,
       v.correlation_id::uuid, v.idempotency_key::uuid
FROM (VALUES
  ('f0000000-0000-4000-8000-000000000151', 'e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000161', 'f0000000-0000-4000-8000-000000000171'),
  ('f0000000-0000-4000-8000-000000000152', 'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000162', 'f0000000-0000-4000-8000-000000000172')
) AS v(id, authorization_item_id, correlation_id, idempotency_key)
JOIN organizations o ON o.code = 'MTD'
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_events (
  id, actor_type, actor_id, organization_id, action, resource_type, resource_id,
  before, after, correlation_id, request_id, result
)
SELECT v.audit_id::uuid, 'USER', 'a0000000-0000-4000-8000-000000000001', o.id,
       'TEST_FIXTURE_MODERATOR_FEE_COLLECTED', 'authorization_item',
       v.authorization_item_id,
       '{"status":"NOT_RECORDED"}'::jsonb,
       '{"status":"COLLECTED","amountCop":"12500.00"}'::jsonb,
       v.correlation_id::uuid, v.correlation_id, 'SUCCESS'
FROM (VALUES
  ('f0000000-0000-4000-8000-000000000181', 'e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000161'),
  ('f0000000-0000-4000-8000-000000000182', 'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000162')
) AS v(audit_id, authorization_item_id, correlation_id)
JOIN organizations o ON o.code = 'MTD'
ON CONFLICT (id) DO NOTHING;

COMMIT;

DO $$
BEGIN
  IF (SELECT count(*) FROM users WHERE username LIKE 'test-%') <> 3 THEN
    RAISE EXCEPTION 'TEST_FIXTURE_ASSERT_USERS';
  END IF;
  IF (SELECT count(*) FROM authorization_items WHERE numero_autorizacion LIKE 'TEST-AUTH-%') <> 6 THEN
    RAISE EXCEPTION 'TEST_FIXTURE_ASSERT_AUTHORIZATIONS';
  END IF;
  IF (SELECT count(*) FROM authorization_fulfillments WHERE id IN (
    'f0000000-0000-4000-8000-000000000121', 'f0000000-0000-4000-8000-000000000122'
  )) <> 2 THEN
    RAISE EXCEPTION 'TEST_FIXTURE_ASSERT_FULFILLMENTS';
  END IF;
END $$;
