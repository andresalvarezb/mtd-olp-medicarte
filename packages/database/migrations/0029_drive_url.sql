ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "drive_url" varchar(2048);
