ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check"
  CHECK ("notification_type" IN ('AUTHORIZATION_READY_TO_DISPENSE', 'DISPENSATION_LOCATION_ASSIGNED', 'DISPENSATION_LOCATION_CHANGED', 'EPS_DIRECTION_PENDING', 'EPS_TARIFF_ANNEX_REJECTED', 'DAILY_OPERATIONAL_REPORT'));
INSERT INTO "notification_templates" ("id", "notification_type", "version", "subject_template", "body_template")
VALUES ('50000000-0000-4000-8000-000000000006', 'EPS_TARIFF_ANNEX_REJECTED', 1,
  'Autorizaciones no procesadas por Anexo Tarifario',
  'La carga {{batchId}} contiene autorizaciones que no pudieron ser procesadas porque el producto autorizado no se encuentra incluido en el Anexo Tarifario vigente.{{itemList}}')
ON CONFLICT DO NOTHING;
