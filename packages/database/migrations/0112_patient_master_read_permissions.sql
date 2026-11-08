-- Dedicated read grants only. No role is granted either capability here.
-- Production assignment remains blocked until identity and scope policies are approved.
INSERT INTO permissions (id, code, description) VALUES
  (gen_random_uuid(), 'patient_master.read', 'Read patient master within an approved organization and point scope'),
  (gen_random_uuid(), 'patient_reconciliation.read', 'Read patient identity reconciliation cases (MTD only)')
ON CONFLICT (code) DO NOTHING;
