-- Additive, nullable profile storage. No personal values are populated by this migration.
-- Runtime reads/writes remain behind DP-07 and field-level permission gates.
ALTER TABLE patients
  ADD COLUMN mtdom_basic_profile jsonb,
  ADD COLUMN mtdom_basic_profile_fetched_at timestamptz,
  ADD COLUMN mtdom_basic_profile_source_updated_at timestamptz,
  ADD COLUMN mtdom_personal_profile jsonb,
  ADD COLUMN mtdom_personal_profile_fetched_at timestamptz,
  ADD COLUMN mtdom_personal_profile_source_updated_at timestamptz;

ALTER TABLE patients
  ADD CONSTRAINT patients_mtdom_basic_profile_allowlist_check CHECK (
    mtdom_basic_profile IS NULL OR (
      jsonb_typeof(mtdom_basic_profile) = 'object'
      AND (mtdom_basic_profile - ARRAY[
        'tipo_identificacion','identificacion','primer_nombre','segundo_nombre','primer_apellido',
        'segundo_apellido','sexo','ciudad','codigo_ciudad','departamento','codigo_departamento',
        'eps','codigo_eps','plan','codigo_plan','tipo','codigo_tipo','condicion','activo',
        'paciente_vivo','fecha_fallecimiento','presente_en_fuente_actual','registraduria_estado',
        'fecha_ultima_validacion_registraduria','actualizado_en'
      ]::text[]) = '{}'::jsonb
    )
  ),
  ADD CONSTRAINT patients_mtdom_personal_profile_allowlist_check CHECK (
    mtdom_personal_profile IS NULL OR (
      jsonb_typeof(mtdom_personal_profile) = 'object'
      AND (mtdom_personal_profile - ARRAY[
        'fecha_nacimiento','direccion','barrio','zona','latitud','longitud','telefono1',
        'telefono2','email','email_validado'
      ]::text[]) = '{}'::jsonb
    )
  );

-- A separate capability is defined but deliberately granted to no role.
INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'patient_master.personal.read', 'Read patient personal profile fields within approved scope')
ON CONFLICT (code) DO NOTHING;
