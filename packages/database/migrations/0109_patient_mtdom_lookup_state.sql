-- RF-PAC-001 Etapa 3: guardar solo estado técnico del lookup.
-- No se persiste el perfil basic ni la respuesta de MTDOM mientras DP-07 siga pendiente.
ALTER TABLE "patients"
  ADD COLUMN "mtdom_lookup_status" varchar(40) DEFAULT 'NOT_REQUESTED' NOT NULL,
  ADD COLUMN "mtdom_last_checked_at" timestamptz,
  ADD COLUMN "mtdom_last_error_code" varchar(80),
  ADD CONSTRAINT "patients_mtdom_lookup_status_check"
    CHECK ("mtdom_lookup_status" IN (
      'NOT_REQUESTED',
      'MATCHED_PENDING_APPROVAL',
      'NOT_FOUND',
      'AMBIGUOUS',
      'IDENTITY_MISMATCH',
      'AUTH_BLOCKED',
      'FAILED'
    ));
