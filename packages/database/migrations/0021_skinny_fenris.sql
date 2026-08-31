ALTER TABLE "audit_reviews" DROP CONSTRAINT "audit_reviews_status_check";--> statement-breakpoint
ALTER TABLE "audit_reviews" DROP CONSTRAINT "audit_reviews_decision_requires_fields_check";--> statement-breakpoint
ALTER TABLE "audit_reviews" DROP CONSTRAINT "audit_reviews_reject_requires_observations_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_enablement_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_direction_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_operation_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_tariff_membership_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_ready_prerequisites_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_audit_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_admission_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_admission_ready_requires_approval_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_dispensed_requires_approval_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT "authorization_items_approval_requires_dispensed_check";--> statement-breakpoint
ALTER TABLE "bulk_update_batches" DROP CONSTRAINT "bulk_update_batches_status_check";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_status_check";--> statement-breakpoint
ALTER TABLE "mipres_checks" DROP CONSTRAINT "mipres_checks_outcome_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_status_check";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_status_check";--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" DROP CONSTRAINT "tariff_annex_imports_status_check";--> statement-breakpoint
ALTER TABLE "audit_reviews" ALTER COLUMN "status" SET DEFAULT 'EN_REVISION';--> statement-breakpoint
ALTER TABLE "authorization_items" ALTER COLUMN "tariff_membership_status" SET DEFAULT 'NO_EVALUADO';--> statement-breakpoint
ALTER TABLE "authorization_items" ALTER COLUMN "audit_status" SET DEFAULT 'NO_INICIADO';--> statement-breakpoint
ALTER TABLE "authorization_items" ALTER COLUMN "admission_status" SET DEFAULT 'NO_LISTO';--> statement-breakpoint
ALTER TABLE "bulk_update_batches" ALTER COLUMN "status" SET DEFAULT 'CARGADO';--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "status" SET DEFAULT 'CARGADO';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE "pending_user_requests" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ALTER COLUMN "status" SET DEFAULT 'CARGADO';--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_status_check" CHECK ("audit_reviews"."status" IN ('EN_REVISION', 'APROBADO', 'RECHAZADO'));--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_decision_requires_fields_check" CHECK ("audit_reviews"."status" = 'EN_REVISION' OR ("audit_reviews"."decided_by" IS NOT NULL AND "audit_reviews"."decided_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_reject_requires_observations_check" CHECK ("audit_reviews"."status" <> 'RECHAZADO' OR "audit_reviews"."observations" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_enablement_status_check" CHECK ("authorization_items"."enablement_status" IN ('HABILITADO', 'BLOQUEADO_POR_ESTADO_ORIGEN'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_direction_status_check" CHECK ("authorization_items"."direction_status" IN ('NO_APLICA', 'PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_operation_status_check" CHECK ("authorization_items"."operation_status" IS NULL OR "authorization_items"."operation_status" IN ('BLOQUEADO', 'LISTO_PARA_DISPENSAR', 'DISPENSACION_REPORTADA', 'DISPENSADO', 'VENCIDO'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_tariff_membership_status_check" CHECK ("authorization_items"."tariff_membership_status" IN ('NO_EVALUADO', 'LISTADO', 'NO_LISTADO'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_ready_prerequisites_check" CHECK ("authorization_items"."operation_status" IS NULL OR "authorization_items"."operation_status" <> 'LISTO_PARA_DISPENSAR' OR (
        "authorization_items"."enablement_status" = 'HABILITADO' AND "authorization_items"."tariff_membership_status" = 'LISTADO' AND (
          ("authorization_items"."coverage_type" = 'PBS' AND "authorization_items"."direction_status" = 'NO_APLICA') OR
          ("authorization_items"."coverage_type" = 'NO_PBS' AND "authorization_items"."direction_status" = 'CONFIRMADO')
        )
      ));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_audit_status_check" CHECK ("authorization_items"."audit_status" IN ('NO_INICIADO', 'LISTO', 'EN_REVISION', 'RECHAZADO', 'APROBADO'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_admission_status_check" CHECK ("authorization_items"."admission_status" IN ('NO_LISTO', 'LISTO'));--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_admission_ready_requires_approval_check" CHECK ("authorization_items"."admission_status" <> 'LISTO' OR "authorization_items"."audit_status" = 'APROBADO');--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_dispensed_requires_approval_check" CHECK ("authorization_items"."operation_status" <> 'DISPENSADO' OR "authorization_items"."audit_status" = 'APROBADO');--> statement-breakpoint
ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_approval_requires_dispensed_check" CHECK ("authorization_items"."audit_status" <> 'APROBADO' OR "authorization_items"."operation_status" = 'DISPENSADO');--> statement-breakpoint
ALTER TABLE "bulk_update_batches" ADD CONSTRAINT "bulk_update_batches_status_check" CHECK ("bulk_update_batches"."status" IN ('CARGADO', 'EN_COLA', 'PROCESANDO', 'COMPLETADO', 'FALLIDO'));--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_status_check" CHECK ("import_batches"."status" IN ('CARGADO', 'VALIDANDO', 'LISTO_PARA_CONFIRMAR', 'CONFIRMANDO', 'COMPLETADO', 'FALLIDO', 'CANCELADO', 'REVIRTIENDO', 'REVERTIDO'));--> statement-breakpoint
ALTER TABLE "mipres_checks" ADD CONSTRAINT "mipres_checks_outcome_check" CHECK ("mipres_checks"."outcome" IN ('PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" IN ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'OMITIDO'));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('PENDIENTE', 'DESPACHADO', 'PROCESADO', 'FALLIDO'));--> statement-breakpoint
ALTER TABLE "pending_user_requests" ADD CONSTRAINT "pending_user_requests_status_check" CHECK ("pending_user_requests"."status" IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" ADD CONSTRAINT "tariff_annex_imports_status_check" CHECK ("tariff_annex_imports"."status" IN ('CARGADO', 'VALIDANDO', 'COMPLETADO', 'FALLIDO'));