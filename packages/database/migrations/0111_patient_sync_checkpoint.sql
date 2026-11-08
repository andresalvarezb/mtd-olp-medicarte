CREATE TABLE patient_sync_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key varchar(80) NOT NULL UNIQUE,
  profile varchar(20) NOT NULL DEFAULT 'basic',
  sync_as_of timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'IDLE',
  run_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  pending_as_of timestamptz,
  next_cursor text,
  cursor_fingerprints jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_page_patient_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  pages_processed integer NOT NULL DEFAULT 0,
  records_seen integer NOT NULL DEFAULT 0,
  local_patients_matched integer NOT NULL DEFAULT 0,
  unrelated_records_skipped integer NOT NULL DEFAULT 0,
  ambiguous_local_records_skipped integer NOT NULL DEFAULT 0,
  boundary_duplicates_skipped integer NOT NULL DEFAULT 0,
  stale_records_skipped integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  last_error_code varchar(80),
  run_started_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_sync_checkpoints_profile_check CHECK (profile = 'basic'),
  CONSTRAINT patient_sync_checkpoints_status_check CHECK (status IN ('IDLE', 'RUNNING', 'FAILED')),
  CONSTRAINT patient_sync_checkpoints_lease_state_check CHECK (
    (status = 'RUNNING' AND run_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status = 'FAILED' AND run_id IS NOT NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (status = 'IDLE' AND run_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND pending_as_of IS NULL AND next_cursor IS NULL)
  ),
  CONSTRAINT patient_sync_checkpoints_counters_check CHECK (
    pages_processed >= 0 AND records_seen >= 0 AND local_patients_matched >= 0
    AND unrelated_records_skipped >= 0 AND ambiguous_local_records_skipped >= 0
    AND boundary_duplicates_skipped >= 0 AND stale_records_skipped >= 0 AND retries >= 0
  ),
  CONSTRAINT patient_sync_checkpoints_arrays_check CHECK (
    jsonb_typeof(cursor_fingerprints) = 'array' AND jsonb_typeof(last_page_patient_ids) = 'array'
  )
);

CREATE INDEX patient_sync_checkpoints_status_lease_idx
  ON patient_sync_checkpoints (status, lease_expires_at);

ALTER TABLE patients
  ADD COLUMN mtdom_changes_seen_at timestamptz;
