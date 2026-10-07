-- 0098_patient_default_dispensing_points
--
-- Punto habitual por paciente.
--
-- Esta configuración NO modifica órdenes de compra históricas.
-- La resolución operacional será:
--
-- 1. patient_schedules
-- 2. patient_default_dispensing_points
-- 3. product_delivery_point_mappings

CREATE TABLE "patient_default_dispensing_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_document" varchar(80) NOT NULL,
  "dispensing_point_id" uuid NOT NULL
    REFERENCES "dispensing_points"("id")
    ON DELETE RESTRICT,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL
    REFERENCES "users"("id")
    ON DELETE RESTRICT,
  "updated_by" uuid NOT NULL
    REFERENCES "users"("id")
    ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "patient_default_dispensing_points_document_unique"
    UNIQUE ("patient_document"),

  CONSTRAINT "patient_default_dispensing_points_document_not_blank"
    CHECK (length(btrim("patient_document")) > 0)
);

CREATE INDEX "patient_default_dispensing_points_active_idx"
  ON "patient_default_dispensing_points" (
    "active",
    "patient_document"
  );

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
  WHERE id =
    '40000000-0000-4000-8000-000000000001'::uuid
  LIMIT 1;

  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'FOUNDATION_ADMIN_NOT_FOUND';
  END IF;

  INSERT INTO dispensing_points (
    organization_id,
    code,
    name,
    active,
    created_by,
    created_at
  )
  SELECT
    v_organization_id,
    point.code,
    point.name,
    true,
    v_created_by,
    now()
  FROM (
    VALUES
      ('BUCARAMANGA', 'Bucaramanga'),
      ('IBAGUE', 'Ibagué'),
      ('VILLAVICENCIO', 'Villavicencio')
  ) AS point(code, name)

  ON CONFLICT (organization_id, code)
  DO UPDATE SET
    name = EXCLUDED.name,
    active = true;

  INSERT INTO patient_default_dispensing_points (
    patient_document,
    dispensing_point_id,
    active,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  SELECT
    assignment.patient_document,
    dp.id,
    true,
    v_created_by,
    v_created_by,
    now(),
    now()

  FROM (
    VALUES
      ('20154715',   'BUCARAMANGA'),
      ('1012919208', 'VILLAVICENCIO'),
      ('1075630229', 'IBAGUE'),
      ('53028171',   'IBAGUE'),
      ('41649123',   'IBAGUE'),
      ('1069179316', 'IBAGUE'),
      ('1000783595', 'IBAGUE'),
      ('19192054',   'IBAGUE')
  ) AS assignment(
    patient_document,
    point_code
  )

  JOIN dispensing_points dp
    ON dp.organization_id =
       v_organization_id
   AND dp.code =
       assignment.point_code

  ON CONFLICT (patient_document)
  DO UPDATE SET
    dispensing_point_id =
      EXCLUDED.dispensing_point_id,
    active = true,
    updated_by =
      EXCLUDED.updated_by,
    updated_at = now();
END;
$$;
