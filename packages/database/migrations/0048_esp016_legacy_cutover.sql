-- ESP-016: classify remaining authorization_items operational columns.
-- No destructive DROP. PostgreSQL remains source of truth.
-- Compatibility projections stay new-domain → legacy only.

COMMENT ON COLUMN "authorization_items"."lugar_dispensacion" IS
  'ESP-016 HISTORICAL_ONLY. Modern source: patient_schedules.dispensing_point_id. Do not use for operational decisions.';
COMMENT ON COLUMN "authorization_items"."fecha_programada" IS
  'ESP-016 HISTORICAL_ONLY. Modern source: patient_schedules.scheduled_date + revision/history. Do not use for operational decisions.';
COMMENT ON COLUMN "authorization_items"."fecha_dispensacion" IS
  'ESP-016 HISTORICAL_ONLY. Delivery/receipt lineage is not 1:1. Do not write from modern workflows.';
COMMENT ON COLUMN "authorization_items"."fecha_aplicacion" IS
  'ESP-016 HISTORICAL_ONLY. Modern source: patient_applications.application_date. CONFIRMED is the APPLIED authority.';
COMMENT ON COLUMN "authorization_items"."cod_autorizacion_medicarte" IS
  'ESP-016 HISTORICAL_ONLY. External identifier with no modern producer. Not an operational status.';
COMMENT ON COLUMN "authorization_items"."orden_compra" IS
  'ESP-016 HISTORICAL_ONLY. Modern source: purchase_orders / purchase_order_lines.';
COMMENT ON COLUMN "authorization_items"."process_status" IS
  'ESP-016 HISTORICAL_ONLY. Collapsed pipeline status. Modern flows use split domain statuses.';
COMMENT ON COLUMN "authorization_items"."operation_status" IS
  'ESP-016 HISTORICAL_ONLY. Modern operational status is derived from applications, outcomes and logistics entities.';
COMMENT ON COLUMN "authorization_items"."operational_version" IS
  'ESP-016 HISTORICAL_ONLY. Modern concurrency uses entity version/revision, not this column.';
COMMENT ON COLUMN "authorization_items"."audit_status" IS
  'ESP-016 DERIVED_COMPATIBILITY. Authority: patient_application_audits. Written only by LegacyCompatibilityProjectionService.';
COMMENT ON COLUMN "authorization_items"."admission_status" IS
  'ESP-016 AUTHORITATIVE downstream READY. Decision authority remains patient_application_audits APPROVED in the same transaction (ESP-012). States after READY are out of scope.';
