-- ESP-020: additive identity/access metadata.
-- Historical migrations remain unchanged. This migration does not delete,
-- deactivate, or reclassify users beyond the safe UNKNOWN default.

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "is_system_admin" boolean NOT NULL DEFAULT false;

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "is_system_managed" boolean NOT NULL DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "provenance" varchar(32) NOT NULL DEFAULT 'UNKNOWN';

UPDATE "roles"
SET
  "is_system_admin" = true,
  "is_system_managed" = true
WHERE "code" = 'MTD_ADMIN';

DO $$
BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_provenance_check"
    CHECK ("provenance" IN (
      'SYSTEM_BOOTSTRAP',
      'TEST_FIXTURE',
      'MANUAL_ADMIN_CREATED',
      'MIGRATED_LEGACY',
      'UNKNOWN'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "roles"
    ADD CONSTRAINT "roles_system_admin_managed_check"
    CHECK (NOT "is_system_admin" OR "is_system_managed");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
