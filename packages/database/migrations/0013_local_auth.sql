-- ADR-026: la autenticacion pasa a ser local. La tabla users evoluciona para
-- ser la autoridad de identidad (username + password_hash argon2id) y deja de
-- depender de Keycloak. Se preservan ids, FKs y evidencia historica.
-- oidc_subject se conserva como dato historico (nullable, deprecado): ya no
-- autentica ni se usa para resolver permisos.
-- pending_user_requests se elimina: era la bandeja de usuarios autenticados en
-- Keycloak sin cuenta local, flujo inexistente con autenticacion local.
-- Los usuarios existentes NO migran contrasenas (no exportables de Keycloak):
-- quedan con password_hash NULL y no pueden iniciar sesion hasta un reset
-- administrativo o el bootstrap de AUTH_BOOTSTRAP_ADMIN_*.

ALTER TABLE "users" ADD COLUMN "username" varchar(160);--> statement-breakpoint
WITH source AS (
  SELECT
    "id",
    "created_at",
    -- base: parte local del email, minuscula y solo con caracteres permitidos;
    -- fallback determinista al id cuando el email no aporta una base util.
    coalesce(
      nullif(
        regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._@-]', '', 'g'),
        ''
      ),
      'user-' || left("id"::text, 8)
    ) AS base_raw
  FROM "users"
),
normalized AS (
  SELECT
    "id",
    "created_at",
    CASE WHEN base_raw ~ '^[a-z0-9]' THEN base_raw ELSE 'u' || base_raw END AS base
  FROM source
),
deduped AS (
  SELECT "id", base, row_number() OVER (PARTITION BY base ORDER BY "created_at", "id") AS rn
  FROM normalized
),
final AS (
  SELECT "id", CASE WHEN rn = 1 THEN base ELSE base || '-' || rn::text END AS derived_username
  FROM deduped
)
UPDATE "users" u
   SET "username" = CASE
     WHEN length(f.derived_username) < 2 THEN f.derived_username || '-u'
     ELSE f.derived_username
   END
  FROM final f
 WHERE u."id" = f."id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "oidc_subject" DROP NOT NULL;--> statement-breakpoint
COMMENT ON COLUMN "users"."oidc_subject" IS 'DEPRECATED (ADR-026): subject del realm Keycloak eliminado. Dato historico; ya no autentica ni resuelve permisos.';--> statement-breakpoint
COMMENT ON COLUMN "users"."email" IS 'Atributo opcional de contacto/visualizacion. El identificador de acceso es username.';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_format_check" CHECK ("username" ~ '^[a-z0-9][a-z0-9._@-]{1,158}$');--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" (lower("username"));--> statement-breakpoint
COMMENT ON COLUMN "users"."password_hash" IS 'Hash argon2id (ADR-026). NULL = sin credencial local: el usuario no puede iniciar sesion hasta un reset administrativo. Nunca se registra en logs, auditoria ni payloads.';--> statement-breakpoint
DROP TABLE "pending_user_requests";
