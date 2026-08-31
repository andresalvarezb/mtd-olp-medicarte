-- Cambio de contrato: los estados de negocio y procesamiento se persisten en
-- espanol con identificadores ASCII. Los codigos tecnicos no se traducen.

ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_enablement_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_direction_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_operation_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_tariff_membership_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_ready_prerequisites_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_audit_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_admission_status_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_admission_ready_requires_approval_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_dispensed_requires_approval_check";--> statement-breakpoint
ALTER TABLE "authorization_items" DROP CONSTRAINT IF EXISTS "authorization_items_approval_requires_dispensed_check";--> statement-breakpoint
ALTER TABLE "mipres_checks" DROP CONSTRAINT IF EXISTS "mipres_checks_outcome_check";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT IF EXISTS "outbox_events_status_check";--> statement-breakpoint
ALTER TABLE "bulk_update_batches" DROP CONSTRAINT IF EXISTS "bulk_update_batches_status_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_status_check";--> statement-breakpoint
ALTER TABLE "audit_reviews" DROP CONSTRAINT IF EXISTS "audit_reviews_status_check";--> statement-breakpoint
ALTER TABLE "audit_reviews" DROP CONSTRAINT IF EXISTS "audit_reviews_decision_requires_fields_check";--> statement-breakpoint
ALTER TABLE "audit_reviews" DROP CONSTRAINT IF EXISTS "audit_reviews_reject_requires_observations_check";--> statement-breakpoint
ALTER TABLE "pending_user_requests" DROP CONSTRAINT IF EXISTS "pending_user_requests_status_check";--> statement-breakpoint
ALTER TABLE "tariff_annex_imports" DROP CONSTRAINT IF EXISTS "tariff_annex_imports_status_check";--> statement-breakpoint

UPDATE "import_batches"
SET "status" = CASE "status"
  WHEN 'UPLOADED' THEN 'CARGADO'
  WHEN 'VALIDATING' THEN 'VALIDANDO'
  WHEN 'READY_TO_CONFIRM' THEN 'LISTO_PARA_CONFIRMAR'
  WHEN 'CONFIRMING' THEN 'CONFIRMANDO'
  WHEN 'COMPLETED' THEN 'COMPLETADO'
  WHEN 'FAILED' THEN 'FALLIDO'
  WHEN 'CANCELLED' THEN 'CANCELADO'
  WHEN 'REVERTING' THEN 'REVIRTIENDO'
  WHEN 'REVERTED' THEN 'REVERTIDO'
  ELSE "status"
END;--> statement-breakpoint

UPDATE "authorization_items"
SET
  "enablement_status" = CASE "enablement_status"
    WHEN 'ENABLED' THEN 'HABILITADO'
    WHEN 'BLOCKED_SOURCE_STATUS' THEN 'BLOQUEADO_POR_ESTADO_ORIGEN'
    ELSE "enablement_status"
  END,
  "direction_status" = CASE "direction_status"
    WHEN 'NOT_APPLICABLE' THEN 'NO_APLICA'
    WHEN 'PENDING' THEN 'PENDIENTE'
    WHEN 'CONFIRMED' THEN 'CONFIRMADO'
    WHEN 'QUERY_ERROR' THEN 'ERROR_DE_CONSULTA'
    ELSE "direction_status"
  END,
  "operation_status" = CASE "operation_status"
    WHEN 'BLOCKED' THEN 'BLOQUEADO'
    WHEN 'READY_TO_DISPENSE' THEN 'LISTO_PARA_DISPENSAR'
    WHEN 'DISPENSATION_REPORTED' THEN 'DISPENSACION_REPORTADA'
    WHEN 'DISPENSED' THEN 'DISPENSADO'
    WHEN 'EXPIRED' THEN 'VENCIDO'
    ELSE "operation_status"
  END,
  "tariff_membership_status" = CASE "tariff_membership_status"
    WHEN 'NOT_EVALUATED' THEN 'NO_EVALUADO'
    WHEN 'LISTED' THEN 'LISTADO'
    WHEN 'NOT_LISTED' THEN 'NO_LISTADO'
    ELSE "tariff_membership_status"
  END,
  "audit_status" = CASE "audit_status"
    WHEN 'NOT_STARTED' THEN 'NO_INICIADO'
    WHEN 'READY' THEN 'LISTO'
    WHEN 'IN_REVIEW' THEN 'EN_REVISION'
    WHEN 'REJECTED' THEN 'RECHAZADO'
    WHEN 'APPROVED' THEN 'APROBADO'
    ELSE "audit_status"
  END,
  "admission_status" = CASE "admission_status"
    WHEN 'NOT_READY' THEN 'NO_LISTO'
    WHEN 'READY' THEN 'LISTO'
    ELSE "admission_status"
  END;--> statement-breakpoint

UPDATE "mipres_checks"
SET "outcome" = CASE "outcome"
  WHEN 'PENDING' THEN 'PENDIENTE'
  WHEN 'CONFIRMED' THEN 'CONFIRMADO'
  WHEN 'QUERY_ERROR' THEN 'ERROR_DE_CONSULTA'
  ELSE "outcome"
END;--> statement-breakpoint

UPDATE "outbox_events"
SET "status" = CASE "status"
  WHEN 'PENDING' THEN 'PENDIENTE'
  WHEN 'DISPATCHED' THEN 'DESPACHADO'
  WHEN 'PROCESSED' THEN 'PROCESADO'
  WHEN 'FAILED' THEN 'FALLIDO'
  ELSE "status"
END;--> statement-breakpoint

UPDATE "bulk_update_batches"
SET "status" = CASE "status"
  WHEN 'UPLOADED' THEN 'CARGADO'
  WHEN 'QUEUED' THEN 'EN_COLA'
  WHEN 'PROCESSING' THEN 'PROCESANDO'
  WHEN 'COMPLETED' THEN 'COMPLETADO'
  WHEN 'FAILED' THEN 'FALLIDO'
  ELSE "status"
END;--> statement-breakpoint

UPDATE "notifications"
SET "status" = CASE "status"
  WHEN 'PENDING' THEN 'PENDIENTE'
  WHEN 'SENT' THEN 'ENVIADO'
  WHEN 'FAILED' THEN 'FALLIDO'
  WHEN 'SKIPPED' THEN 'OMITIDO'
  ELSE "status"
END;--> statement-breakpoint

UPDATE "audit_reviews"
SET "status" = CASE "status"
  WHEN 'IN_REVIEW' THEN 'EN_REVISION'
  WHEN 'APPROVED' THEN 'APROBADO'
  WHEN 'REJECTED' THEN 'RECHAZADO'
  ELSE "status"
END;--> statement-breakpoint

UPDATE "pending_user_requests"
SET "status" = CASE "status"
  WHEN 'PENDING' THEN 'PENDIENTE'
  WHEN 'APPROVED' THEN 'APROBADO'
  WHEN 'REJECTED' THEN 'RECHAZADO'
  ELSE "status"
END;--> statement-breakpoint

UPDATE "tariff_annex_imports"
SET "status" = CASE "status"
  WHEN 'UPLOADED' THEN 'CARGADO'
  WHEN 'VALIDATING' THEN 'VALIDANDO'
  WHEN 'COMPLETED' THEN 'COMPLETADO'
  WHEN 'FAILED' THEN 'FALLIDO'
  ELSE "status"
END;--> statement-breakpoint

-- Las respuestas cacheadas deben respetar el contrato nuevo al reproducirse.
CREATE OR REPLACE FUNCTION translate_backend_status_json(value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  object_value jsonb;
  object_key text;
  child_value jsonb;
  translated_value text;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) = 'null' THEN
    RETURN value;
  END IF;

  IF jsonb_typeof(value) = 'object' THEN
    object_value := '{}'::jsonb;
    FOR object_key, child_value IN
      SELECT entry.key, entry.value
      FROM jsonb_each(value) AS entry
    LOOP
      IF object_key IN (
        'status',
        'outcome',
        'batchStatus',
        'enablementStatus',
        'directionStatus',
        'operationStatus',
        'auditStatus',
        'admissionStatus',
        'tariffMembershipStatus',
        'applicationSiteStatus',
        'applicationDateStatus'
      ) AND jsonb_typeof(child_value) = 'string' THEN
        translated_value := CASE child_value #>> '{}'
          WHEN 'UPLOADED' THEN 'CARGADO'
          WHEN 'VALIDATING' THEN 'VALIDANDO'
          WHEN 'READY_TO_CONFIRM' THEN 'LISTO_PARA_CONFIRMAR'
          WHEN 'CONFIRMING' THEN 'CONFIRMANDO'
          WHEN 'COMPLETED' THEN 'COMPLETADO'
          WHEN 'FAILED' THEN 'FALLIDO'
          WHEN 'CANCELLED' THEN 'CANCELADO'
          WHEN 'REVERTING' THEN 'REVIRTIENDO'
          WHEN 'REVERTED' THEN 'REVERTIDO'
          WHEN 'ENABLED' THEN 'HABILITADO'
          WHEN 'BLOCKED_SOURCE_STATUS' THEN 'BLOQUEADO_POR_ESTADO_ORIGEN'
          WHEN 'NOT_APPLICABLE' THEN 'NO_APLICA'
          WHEN 'PENDING' THEN 'PENDIENTE'
          WHEN 'CONFIRMED' THEN 'CONFIRMADO'
          WHEN 'QUERY_ERROR' THEN 'ERROR_DE_CONSULTA'
          WHEN 'BLOCKED' THEN 'BLOQUEADO'
          WHEN 'READY_TO_DISPENSE' THEN 'LISTO_PARA_DISPENSAR'
          WHEN 'DISPENSATION_REPORTED' THEN 'DISPENSACION_REPORTADA'
          WHEN 'DISPENSED' THEN 'DISPENSADO'
          WHEN 'EXPIRED' THEN 'VENCIDO'
          WHEN 'NOT_EVALUATED' THEN 'NO_EVALUADO'
          WHEN 'LISTED' THEN 'LISTADO'
          WHEN 'NOT_LISTED' THEN 'NO_LISTADO'
          WHEN 'NOT_STARTED' THEN 'NO_INICIADO'
          WHEN 'READY' THEN 'LISTO'
          WHEN 'IN_REVIEW' THEN 'EN_REVISION'
          WHEN 'REJECTED' THEN 'RECHAZADO'
          WHEN 'APPROVED' THEN 'APROBADO'
          WHEN 'NOT_READY' THEN 'NO_LISTO'
          WHEN 'PENDING_ASSIGNMENT' THEN 'PENDIENTE_ASIGNACION'
          WHEN 'ASSIGNED' THEN 'ASIGNADO'
          WHEN 'MISSING' THEN 'FALTANTE'
          WHEN 'PRESENT' THEN 'PRESENTE'
          WHEN 'DISPATCHED' THEN 'DESPACHADO'
          WHEN 'PROCESSED' THEN 'PROCESADO'
          WHEN 'QUEUED' THEN 'EN_COLA'
          WHEN 'PROCESSING' THEN 'PROCESANDO'
          WHEN 'SENT' THEN 'ENVIADO'
          WHEN 'SKIPPED' THEN 'OMITIDO'
          WHEN 'DEDUPLICATED' THEN 'DEDUPLICADO'
          WHEN 'ACTIVE' THEN 'ACTIVO'
          WHEN 'INACTIVE' THEN 'INACTIVO'
          WHEN 'accepted' THEN 'ACEPTADO'
          WHEN 'PENDING_VALIDATION' THEN 'PENDIENTE_DE_VALIDACION'
          ELSE child_value #>> '{}'
        END;
        object_value := object_value || jsonb_build_object(object_key, translated_value);
      ELSE
        object_value := object_value || jsonb_build_object(
          object_key,
          translate_backend_status_json(child_value)
        );
      END IF;
    END LOOP;
    RETURN object_value;
  END IF;

  IF jsonb_typeof(value) = 'array' THEN
    RETURN (
      SELECT COALESCE(
        jsonb_agg(translate_backend_status_json(array_value)),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(value) AS array_entry(array_value)
    );
  END IF;

  RETURN value;
END;
$$;--> statement-breakpoint

UPDATE "job_results" SET "result" = translate_backend_status_json("result");--> statement-breakpoint
UPDATE "idempotency_records" SET "response" = translate_backend_status_json("response");--> statement-breakpoint
DROP FUNCTION translate_backend_status_json(jsonb);--> statement-breakpoint

ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_status_check"
  CHECK ("status" IN ('CARGADO', 'VALIDANDO', 'LISTO_PARA_CONFIRMAR', 'CONFIRMANDO', 'COMPLETADO', 'FALLIDO', 'CANCELADO', 'REVIRTIENDO', 'REVERTIDO'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_enablement_status_check"
  CHECK ("enablement_status" IN ('HABILITADO', 'BLOQUEADO_POR_ESTADO_ORIGEN'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_direction_status_check"
  CHECK ("direction_status" IN ('NO_APLICA', 'PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_operation_status_check"
  CHECK ("operation_status" IS NULL OR "operation_status" IN ('BLOQUEADO', 'LISTO_PARA_DISPENSAR', 'DISPENSACION_REPORTADA', 'DISPENSADO', 'VENCIDO'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_tariff_membership_status_check"
  CHECK ("tariff_membership_status" IN ('NO_EVALUADO', 'LISTADO', 'NO_LISTADO'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_ready_prerequisites_check"
  CHECK ("operation_status" IS NULL OR "operation_status" <> 'LISTO_PARA_DISPENSAR' OR (
    "enablement_status" = 'HABILITADO' AND "tariff_membership_status" = 'LISTADO' AND (
      ("coverage_type" = 'PBS' AND "direction_status" = 'NO_APLICA') OR
      ("coverage_type" = 'NO_PBS' AND "direction_status" = 'CONFIRMADO')
    )
  ));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_audit_status_check"
  CHECK ("audit_status" IN ('NO_INICIADO', 'LISTO', 'EN_REVISION', 'RECHAZADO', 'APROBADO'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_admission_status_check"
  CHECK ("admission_status" IN ('NO_LISTO', 'LISTO'));--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_admission_ready_requires_approval_check"
  CHECK ("admission_status" <> 'LISTO' OR "audit_status" = 'APROBADO');--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_dispensed_requires_approval_check"
  CHECK ("operation_status" <> 'DISPENSADO' OR "audit_status" = 'APROBADO');--> statement-breakpoint
ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_approval_requires_dispensed_check"
  CHECK ("audit_status" <> 'APROBADO' OR "operation_status" = 'DISPENSADO');--> statement-breakpoint
ALTER TABLE "mipres_checks"
  ADD CONSTRAINT "mipres_checks_outcome_check"
  CHECK ("outcome" IN ('PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA'));--> statement-breakpoint
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_status_check"
  CHECK ("status" IN ('PENDIENTE', 'DESPACHADO', 'PROCESADO', 'FALLIDO'));--> statement-breakpoint
ALTER TABLE "bulk_update_batches"
  ADD CONSTRAINT "bulk_update_batches_status_check"
  CHECK ("status" IN ('CARGADO', 'EN_COLA', 'PROCESANDO', 'COMPLETADO', 'FALLIDO'));--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_status_check"
  CHECK ("status" IN ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'OMITIDO'));--> statement-breakpoint
ALTER TABLE "audit_reviews"
  ADD CONSTRAINT "audit_reviews_status_check"
  CHECK ("status" IN ('EN_REVISION', 'APROBADO', 'RECHAZADO'));--> statement-breakpoint
ALTER TABLE "audit_reviews"
  ADD CONSTRAINT "audit_reviews_decision_requires_fields_check"
  CHECK ("status" = 'EN_REVISION' OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "audit_reviews"
  ADD CONSTRAINT "audit_reviews_reject_requires_observations_check"
  CHECK ("status" <> 'RECHAZADO' OR "observations" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "pending_user_requests"
  ADD CONSTRAINT "pending_user_requests_status_check"
  CHECK ("status" IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));--> statement-breakpoint
ALTER TABLE "tariff_annex_imports"
  ADD CONSTRAINT "tariff_annex_imports_status_check"
  CHECK ("status" IN ('CARGADO', 'VALIDANDO', 'COMPLETADO', 'FALLIDO'));
