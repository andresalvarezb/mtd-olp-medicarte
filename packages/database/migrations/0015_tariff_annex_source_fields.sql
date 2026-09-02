-- Mapeo de la plantilla comercial vigente del Anexo Tarifario.
ALTER TABLE "tariff_annex_products"
  ADD COLUMN "tarifa_unidad" varchar(255),
  ADD COLUMN "numero_expediente_invima" varchar(255),
  ADD COLUMN "consecutivo_invima_presentacion" varchar(255),
  ADD COLUMN "descripcion_generica" text,
  ADD COLUMN "descripcion_comercial" text,
  ADD COLUMN "laboratorio" varchar(500),
  ADD COLUMN "tipo_inclusion" varchar(100);
