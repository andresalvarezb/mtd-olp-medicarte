-- 0097_bucaramanga_dispensing_point
--
-- Nuevo punto operacional MEDICARTE.
--
-- BUCARAMANGA es un punto físico disponible para programación de pacientes.
-- La selección del punto de una OC se resolverá desde patient_schedules cuando
-- exista programación activa. No se crean mappings producto -> BUCARAMANGA.

DO $$
DECLARE
  v_organization_id uuid;
  v_created_by uuid;
BEGIN
  SELECT id
  INTO v_organization_id
  FROM organizations
  WHERE code = 'MEDICARTE'
    AND active = true
  LIMIT 1;

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'MEDICARTE_ORGANIZATION_NOT_FOUND';
  END IF;

  SELECT id
  INTO v_created_by
  FROM users
  WHERE id = '40000000-0000-4000-8000-000000000001'::uuid
  LIMIT 1;

  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'FOUNDATION_ADMIN_NOT_FOUND';
  END IF;

  INSERT INTO dispensing_points (
    id,
    organization_id,
    code,
    name,
    active,
    created_by,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    v_organization_id,
    'BUCARAMANGA',
    'Bucaramanga',
    true,
    v_created_by,
    now()
  )
  ON CONFLICT (organization_id, code)
  DO UPDATE SET
    name = EXCLUDED.name,
    active = true;
END;
$$;
