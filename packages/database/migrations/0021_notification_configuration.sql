CREATE TABLE "notification_email_settings" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "sender_email" varchar(320),
  "updated_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_at" timestamptz
);
ALTER TABLE "notifications" ADD COLUMN "sender_email" varchar(320);
INSERT INTO "notification_templates" ("id", "notification_type", "version", "subject_template", "body_template") VALUES
  ('50000000-0000-4000-8000-000000000007', 'AUTHORIZATION_IMPORT_REJECTED', 1,
   'Autorizaciones rechazadas en cargue {{batchId}}',
   'El cargue {{batchId}} fue procesado el {{processedAt}}. Registros rechazados: {{rejectedCount}}. Motivos:{{reasons}}{{itemList}}'),
  ('50000000-0000-4000-8000-000000000008', 'DISPENSATION_DATE_REPORTED', 1,
   'Dispensación reportada por OLP',
   'OLP reportó la dispensación de {{itemCount}} autorización(es). Registros:{{itemList}}'),
  ('50000000-0000-4000-8000-000000000009', 'APPLICATION_DATE_REPORTED', 1,
   'Aplicación reportada por Medicarte',
   'Medicarte reportó la aplicación de {{itemCount}} autorización(es). Registros:{{itemList}}')
ON CONFLICT DO NOTHING;
