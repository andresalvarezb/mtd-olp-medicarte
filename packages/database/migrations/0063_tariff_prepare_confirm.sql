-- W2 / Tariff convergence: explicit PREPARE -> CONFIRM lifecycle.
-- No active tariff catalog mutation is performed by this migration.

ALTER TABLE "tariff_annex_imports"
  DROP CONSTRAINT IF EXISTS "tariff_annex_imports_status_check";
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_status_check"
  CHECK (
    "status" IN (
      'PREPARED',
      'CONFIRMING',
      'UPLOADED',
      'VALIDATING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
  );
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview" jsonb;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview_total" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview_unchanged" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview_changed" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview_anomalous" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview_rejected" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "preview_scale_pattern_detected" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "confirmed_by" uuid;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD COLUMN IF NOT EXISTS "override_reason" text;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_confirmed_by_users_id_fk"
  FOREIGN KEY ("confirmed_by")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_preview_total_check"
  CHECK ("preview_total" >= 0);
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_preview_unchanged_check"
  CHECK ("preview_unchanged" >= 0);
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_preview_changed_check"
  CHECK ("preview_changed" >= 0);
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_preview_anomalous_check"
  CHECK ("preview_anomalous" >= 0);
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_preview_rejected_check"
  CHECK ("preview_rejected" >= 0);
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_preview_consistency_check"
  CHECK (
    "preview_total" =
      "preview_unchanged" +
      "preview_changed" +
      "preview_anomalous" +
      "preview_rejected"
  );
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_confirmation_check"
  CHECK (
    (
      "status" <> 'CONFIRMING'
    )
    OR
    (
      "confirmed_at" IS NOT NULL
      AND "confirmed_by" IS NOT NULL
    )
  );
--> statement-breakpoint

ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_anomaly_override_check"
  CHECK (
    "preview_anomalous" = 0
    OR "status" NOT IN ('CONFIRMING', 'COMPLETED')
    OR length(btrim(coalesce("override_reason", ''))) > 0
  );
