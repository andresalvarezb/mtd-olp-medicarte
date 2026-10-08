/*
 * Índice documental de soportes Google Drive por AUTO.
 *
 * Independiente del estado de auditoría:
 *
 * authorization_items
 *   1 -> 1 authorization_drive_support_sync
 *   1 -> N authorization_drive_supports
 *
 * La auditoría consume este índice, pero no es necesaria
 * para descubrir o conservar soportes.
 */

CREATE TABLE "authorization_drive_support_sync" (
  "authorization_item_id" uuid PRIMARY KEY
    REFERENCES "authorization_items"("id")
    ON DELETE CASCADE,

  "support_status" varchar(30) NOT NULL DEFAULT 'UNKNOWN',

  "evidence_count" integer NOT NULL DEFAULT 0,

  "last_checked_at" timestamptz,

  "last_success_at" timestamptz,

  "next_check_at" timestamptz NOT NULL DEFAULT now(),

  "consecutive_failures" integer NOT NULL DEFAULT 0,

  "last_error" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "authorization_drive_support_sync_status_check"
    CHECK (
      "support_status" IN (
        'UNKNOWN',
        'WITH_SUPPORT',
        'WITHOUT_SUPPORT'
      )
    ),

  CONSTRAINT "authorization_drive_support_sync_evidence_count_check"
    CHECK (
      "evidence_count" >= 0
    ),

  CONSTRAINT "authorization_drive_support_sync_failures_check"
    CHECK (
      "consecutive_failures" >= 0
    )
);


CREATE INDEX
  "authorization_drive_support_sync_due_idx"
ON
  "authorization_drive_support_sync" (
    "next_check_at",
    "last_checked_at",
    "authorization_item_id"
  );


CREATE TABLE "authorization_drive_supports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "authorization_item_id" uuid NOT NULL
    REFERENCES "authorization_items"("id")
    ON DELETE CASCADE,

  "drive_file_id" varchar(255) NOT NULL,

  "file_name" text NOT NULL,

  "mime_type" varchar(255),

  "web_view_link" text,

  "size_bytes" numeric(20, 0),

  "md5_checksum" varchar(64),

  "drive_modified_at" timestamptz,

  "first_seen_at" timestamptz NOT NULL DEFAULT now(),

  "last_seen_at" timestamptz NOT NULL DEFAULT now(),

  "missing_since" timestamptz,

  "is_present" boolean NOT NULL DEFAULT true,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "authorization_drive_supports_file_id_not_blank_check"
    CHECK (
      length(btrim("drive_file_id")) > 0
    ),

  CONSTRAINT "authorization_drive_supports_file_name_not_blank_check"
    CHECK (
      length(btrim("file_name")) > 0
    ),

  CONSTRAINT "authorization_drive_supports_size_check"
    CHECK (
      "size_bytes" IS NULL
      OR "size_bytes" >= 0
    )
);


CREATE UNIQUE INDEX
  "authorization_drive_supports_authorization_file_unique"
ON
  "authorization_drive_supports" (
    "authorization_item_id",
    "drive_file_id"
  );


CREATE INDEX
  "authorization_drive_supports_present_idx"
ON
  "authorization_drive_supports" (
    "authorization_item_id",
    "is_present",
    "last_seen_at"
  );


/*
 * Backfill de soportes que ya habían sido descubiertos
 * desde el flujo de auditoría anterior.
 */
INSERT INTO authorization_drive_supports (
  authorization_item_id,
  drive_file_id,
  file_name,
  mime_type,
  web_view_link,
  size_bytes,
  md5_checksum,
  drive_modified_at,
  first_seen_at,
  last_seen_at,
  is_present,
  created_at,
  updated_at
)
SELECT
  aba.authorization_item_id,
  abae.drive_file_id,
  abae.file_name,
  abae.mime_type,
  abae.web_view_link,
  abae.size_bytes,
  abae.md5_checksum,
  abae.drive_modified_at,
  abae.created_at,
  greatest(
    abae.discovered_at,
    abae.created_at
  ),
  true,
  abae.created_at,
  now()
FROM
  authorization_billing_audit_evidence abae
JOIN
  authorization_billing_audits aba
    ON aba.id =
       abae.billing_audit_id
ON CONFLICT (
  authorization_item_id,
  drive_file_id
)
DO NOTHING;


/*
 * Las AUTOs que ya tienen evidencia conocida arrancan
 * como WITH_SUPPORT.
 *
 * Las demás no necesitan fila inicial: el worker las
 * selecciona por ausencia del registro y las procesa
 * progresivamente.
 */
INSERT INTO authorization_drive_support_sync (
  authorization_item_id,
  support_status,
  evidence_count,
  last_checked_at,
  last_success_at,
  next_check_at,
  consecutive_failures,
  last_error
)
SELECT
  authorization_item_id,
  'WITH_SUPPORT',
  count(*)::int,
  now(),
  now(),
  now(),
  0,
  null
FROM
  authorization_drive_supports
WHERE
  is_present = true
GROUP BY
  authorization_item_id
ON CONFLICT (
  authorization_item_id
)
DO NOTHING;
