-- Resolución de decisiones DEC-018, DEC-019 y DEC-020 (Anexo Tarifario).
-- Aprobadas por el responsable; detalle en .agent/DECISIONS_PENDING.md.

-- DEC-019: evidencia de la fila mapeada del cargue comercial del Anexo.
ALTER TABLE "tariff_annex_products" ADD COLUMN "source_data" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- DEC-018: reinicio de la persistencia operativa. Se eliminan TODOS los
-- registros operativos y de configuración de catálogo; se conservan
-- exclusivamente las credenciales y el acceso (organizations, users, roles,
-- permissions, role_permissions, user_organization_roles, pending_user_requests).
-- Los ítems preexistentes ya no quedan abuelados: la base arranca limpia y el
-- Anexo Tarifario se carga como semilla (DEC-019) antes de importar.
-- En bases nuevas este borrado es un no-op.
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  "tariff_annex_import_rows",
  "tariff_annex_import_source_files",
  "tariff_annex_imports",
  "tariff_annex_products",
  "authorization_items",
  "authorization_item_organizations",
  "coverage_evaluations",
  "mipres_checks",
  "mipres_directions",
  "operational_field_changes",
  "audit_reviews",
  "audit_findings",
  "import_rows",
  "validation_errors",
  "import_source_files",
  "import_batches",
  "bulk_update_rows",
  "bulk_update_source_files",
  "bulk_update_batches",
  "notifications",
  "outbox_events",
  "job_results",
  "idempotency_records",
  "audit_events"
RESTART IDENTITY CASCADE;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- DEC-020: matriz de roles MTD con exactamente tres roles.
--   MTD_ADMIN          acceso a todo (sembrado por 0010).
--   MTD_AUTORIZACIONES solo carga autorizaciones; el resto, solo lectura.
--   MTD_AUDITOR        manipula únicamente soportes y auditoría.
-- OLP y MEDICARTE continúan sin cambios.
-- ---------------------------------------------------------------------------
INSERT INTO "roles" ("id", "code", "name") VALUES
  ('20000000-0000-4000-8000-000000000008', 'MTD_AUTORIZACIONES', 'MTD Autorizaciones')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_AUTORIZACIONES'
  AND p."code" IN (
    'authorizations.read',
    'authorizations.read_sensitive',
    'imports.create',
    'imports.confirm'
  )
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- El auditor manipula la sección de auditoría (iniciar, hallazgos, rechazar,
-- aprobar) y solo lectura en el resto.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_AUDITOR'
  AND p."code" IN ('audit.reject', 'audit.findings.create')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- MTD_OPERATOR desaparece: la operación de MTD se divide entre
-- MTD_AUTORIZACIONES y MTD_AUDITOR (DEC-020). No tenía usuarios asignados.
DELETE FROM "role_permissions" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'MTD_OPERATOR');--> statement-breakpoint
DELETE FROM "user_organization_roles" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'MTD_OPERATOR');--> statement-breakpoint
DELETE FROM "roles" WHERE "code" = 'MTD_OPERATOR';