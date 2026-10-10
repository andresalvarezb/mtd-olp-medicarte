-- ESP-AUD-BULK-001: importacion XLSX de auditoria de facturacion por AUTO.
-- Decisiones REVIEWED permanecen protegidas por el trigger existente (0096).

create table authorization_billing_audit_bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  created_by uuid not null references users(id) on delete restrict,
  correlation_id uuid not null,
  template_version varchar(80) not null,
  filename varchar(255) not null,
  file_hash varchar(64) not null,
  status varchar(25) not null,
  total_rows integer not null,
  valid_rows integer not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  constraint billing_bulk_jobs_status_check check
    (status in ('READY', 'INVALID', 'PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED')),
  constraint billing_bulk_jobs_counts_check check
    (total_rows between 1 and 5000 and valid_rows >= 0 and valid_rows <= total_rows)
);

create index billing_bulk_jobs_org_created_idx
  on authorization_billing_audit_bulk_jobs(organization_id, created_at desc);

create table authorization_billing_audit_bulk_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references authorization_billing_audit_bulk_jobs(id) on delete restrict,
  row_number integer not null,
  authorization_key text not null,
  result varchar(30),
  observation text,
  validation_status varchar(15) not null,
  execution_status varchar(15) not null,
  error_code varchar(80),
  error_message text,
  billing_audit_id uuid references authorization_billing_audits(id) on delete restrict,
  operational_status_at_decision varchar(40),
  executed_at timestamptz,
  unique (job_id, row_number),
  constraint billing_bulk_rows_validation_check check (validation_status in ('VALID', 'INVALID')),
  constraint billing_bulk_rows_execution_check check (execution_status in ('PENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  constraint billing_bulk_rows_result_check check (result is null or result in ('COMPLIES', 'DOES_NOT_COMPLY')),
  constraint billing_bulk_rows_number_check check (row_number >= 2)
);

create index billing_bulk_rows_job_state_idx
  on authorization_billing_audit_bulk_rows(job_id, execution_status, row_number);
