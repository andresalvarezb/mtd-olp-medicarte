-- Alinear los valores por defecto de PostgreSQL con el catalogo de estados en
-- espanol. La migracion anterior convierte filas existentes y restricciones,
-- pero no puede dejar los defaults historicos activos.

ALTER TABLE "import_batches" ALTER COLUMN "status" SET DEFAULT 'CARGADO';--> statement-breakpoint
ALTER TABLE "authorization_items" ALTER COLUMN "tariff_membership_status" SET DEFAULT 'NO_EVALUADO';--> statement-breakpoint
ALTER TABLE "authorization_items" ALTER COLUMN "audit_status" SET DEFAULT 'NO_INICIADO';--> statement-breakpoint
ALTER TABLE "authorization_items" ALTER COLUMN "admission_status" SET DEFAULT 'NO_LISTO';--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE "bulk_update_batches" ALTER COLUMN "status" SET DEFAULT 'CARGADO';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE "audit_reviews" ALTER COLUMN "status" SET DEFAULT 'EN_REVISION';--> statement-breakpoint
ALTER TABLE "pending_user_requests" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ALTER COLUMN "status" SET DEFAULT 'CARGADO';
