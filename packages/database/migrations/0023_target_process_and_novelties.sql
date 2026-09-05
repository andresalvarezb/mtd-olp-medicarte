-- FASE 2: modelo aditivo para el flujo objetivo. Las columnas y estados
-- anteriores se conservan para compatibilidad e historial.
ALTER TABLE "authorization_items"
  ADD COLUMN "process_status" varchar(40),
  ADD COLUMN "cod_autorizacion_medicarte" varchar(255),
  ADD COLUMN "orden_compra" varchar(255),
  ADD COLUMN "updated_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD COLUMN "last_load_id" uuid REFERENCES "import_batches"("id") ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "authorization_items"
    GROUP BY "authorization_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'FASE 2 migration blocked: historical LLAVE collisions require human reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX "authorization_items_authorization_key_idx"
  ON "authorization_items" ("authorization_key");

ALTER TABLE "authorization_items"
  ADD CONSTRAINT "authorization_items_process_status_check"
  CHECK ("process_status" IS NULL OR "process_status" IN (
    'NOVEDAD', 'PENDIENTE_VALIDACION_MIPRES', 'LISTO_PARA_DISPENSAR',
    'PENDIENTE_ORDEN_COMPRA', 'PENDIENTE_DISPENSACION',
    'PENDIENTE_APLICACION', 'LISTO_PARA_AUDITORIA',
    'AUDITORIA_APROBADA', 'AUDITORIA_RECHAZADA'
  ));

ALTER TABLE "bulk_update_batches"
  DROP CONSTRAINT IF EXISTS "bulk_update_batches_operation_type_check";
ALTER TABLE "bulk_update_batches"
  ADD CONSTRAINT "bulk_update_batches_operation_type_check" CHECK ("operation_type" IN (
    'ASSIGN_DISPENSATION_LOCATION', 'ASSIGN_PURCHASE_ORDER',
    'REPORT_DISPENSATION_DATE', 'REPORT_APPLICATION_DATE'
  ));

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'bulk_updates.purchase_order', 'Register purchase orders in MTD')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'MTD_ADMIN' AND p."code" = 'bulk_updates.purchase_order'
ON CONFLICT DO NOTHING;

CREATE TABLE "novelty_codes" (
  "code" varchar(30) PRIMARY KEY,
  "stage" varchar(60) NOT NULL,
  "field" varchar(160),
  "description" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "novelties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_item_id" uuid REFERENCES "authorization_items"("id") ON DELETE RESTRICT,
  "import_batch_id" uuid REFERENCES "import_batches"("id") ON DELETE RESTRICT,
  "bulk_update_batch_id" uuid REFERENCES "bulk_update_batches"("id") ON DELETE RESTRICT,
  "source_row_number" integer,
  "original_row" jsonb NOT NULL,
  "code" varchar(30) NOT NULL REFERENCES "novelty_codes"("code") ON DELETE RESTRICT,
  "stage" varchar(60) NOT NULL,
  "field" varchar(160),
  "received_value" text,
  "description" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "processed_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "novelties_item_active_idx"
  ON "novelties" ("authorization_item_id", "active", "processed_at");
CREATE INDEX "novelties_code_idx" ON "novelties" ("code", "processed_at");
CREATE INDEX "novelties_batch_idx" ON "novelties" ("import_batch_id", "bulk_update_batch_id");

INSERT INTO "novelty_codes" ("code", "stage", "field", "description") VALUES
  ('CSV_001', 'CSV', null, 'El archivo completo ya fue procesado; no se reprocesa por coincidencia de hash SHA-256.'),
  ('CSV_002', 'CSV', 'LLAVE', 'La LLAVE aparece mas de una vez dentro del archivo; ninguna fila de esa LLAVE fue procesada.'),
  ('CSV_003', 'CSV', null, 'Falta una columna obligatoria del contrato CSV.'),
  ('CSV_004', 'CSV', null, 'El valor obligatorio esta vacio.'),
  ('CSV_005', 'CSV', null, 'El valor no cumple el formato CSV o de datos esperado.'),
  ('AUTH_001', 'AUTORIZACIONES', 'FECHA_FINAL_VIGENCIA', 'FECHA_FINAL_VIGENCIA no tiene formato YYYY-MM-DD valido.'),
  ('AUTH_002', 'AUTORIZACIONES', 'FECHA_FINAL_VIGENCIA', 'La autorizacion vencio antes de registrar la dispensacion.'),
  ('AUTH_003', 'AUTORIZACIONES', null, 'La autorizacion esta bloqueada por avance operacional.'),
  ('AUTH_004', 'AUTORIZACIONES', 'LLAVE', 'No se permite modificar la llave de negocio.'),
  ('ANX_001', 'ANEXO_TARIFARIO', 'CODIGO_PRODUCTO', 'El producto no existe en el Anexo Tarifario.'),
  ('ANX_002', 'ANEXO_TARIFARIO', 'CODIGO_PRODUCTO', 'El producto existe pero esta inactivo.'),
  ('ANX_003', 'ANEXO_TARIFARIO', 'TIPO_INCLUSION_MEDICAMENTO', 'La clasificacion debe ser PBS o NO PBS.'),
  ('CLS_001', 'CLASIFICACION', 'NUMERO_PRESCRIPCION', 'La prescripcion debe estar vacia o contener exactamente 20 digitos.'),
  ('CLS_002', 'CLASIFICACION', 'NUMERO_PRESCRIPCION', 'La combinacion de prescripcion y clasificacion PBS/NO PBS es inconsistente.'),
  ('MIP_001', 'MIPRES', null, 'La validacion MIPRES no fue aprobada por un usuario.'),
  ('MED_001', 'MEDICARTE', null, 'Faltan uno o mas campos de la asignacion inicial MEDICARTE.'),
  ('MTD_001', 'MTD_COMPRAS', 'ORDEN_COMPRA', 'La orden de compra es invalida o esta vacia.'),
  ('OLP_001', 'OLP', 'FECHA_DISPENSACION', 'FECHA_DISPENSACION no tiene formato YYYY-MM-DD valido.'),
  ('MED_002', 'MEDICARTE', 'FECHA_APLICACION', 'FECHA_APLICACION no tiene formato YYYY-MM-DD valido.'),
  ('AUD_001', 'AUDITORIA', null, 'La autorizacion fue rechazada en auditoria.'),
  ('LOCK_001', 'OPERACION', null, 'La etapa esta bloqueada por avance del proceso.'),
  ('CONC_001', 'OPERACION', null, 'El registro fue modificado por otro proceso; no se sobrescribio el cambio.'),
  ('MIG_001', 'MIGRACION', null, 'El estado historico requiere conciliacion humana y no fue migrado automaticamente.')
ON CONFLICT ("code") DO NOTHING;

-- Solo se proyectan casos inequívocos. Los casos restantes se concilian en la
-- aplicacion y no se fuerza una conversion destructiva.
UPDATE "authorization_items"
SET "process_status" = CASE
  WHEN "audit_status" = 'APPROVED' THEN 'AUDITORIA_APROBADA'
  WHEN "audit_status" = 'REJECTED' THEN 'AUDITORIA_RECHAZADA'
  WHEN "fecha_aplicacion" IS NOT NULL AND "fecha_dispensacion" IS NOT NULL THEN 'LISTO_PARA_AUDITORIA'
  WHEN "fecha_dispensacion" IS NOT NULL THEN 'PENDIENTE_APLICACION'
  WHEN "lugar_dispensacion" IS NOT NULL AND "fecha_programada" IS NOT NULL AND "cod_autorizacion_medicarte" IS NOT NULL AND "orden_compra" IS NULL THEN 'PENDIENTE_ORDEN_COMPRA'
  WHEN "orden_compra" IS NOT NULL THEN 'PENDIENTE_DISPENSACION'
  WHEN "operation_status" = 'READY_TO_DISPENSE' THEN 'LISTO_PARA_DISPENSAR'
  WHEN "coverage_type" = 'NO_PBS' AND "direction_status" = 'PENDING' THEN 'PENDIENTE_VALIDACION_MIPRES'
  ELSE 'NOVEDAD'
END
WHERE "process_status" IS NULL;
