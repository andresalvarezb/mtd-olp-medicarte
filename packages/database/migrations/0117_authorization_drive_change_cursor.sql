CREATE TABLE "authorization_drive_change_cursors" (
  "feed_key" varchar(200) PRIMARY KEY,
  "drive_id" text,
  "page_token" text NOT NULL,
  "initial_backfill_complete" boolean NOT NULL DEFAULT false,
  "next_poll_at" timestamptz NOT NULL DEFAULT now(),
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "authorization_drive_change_cursors_failures_check"
    CHECK ("consecutive_failures" >= 0)
);
