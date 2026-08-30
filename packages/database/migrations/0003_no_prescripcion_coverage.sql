-- DEC-016: la clasificacion de cobertura depende de `No.PRESCRIPCION`.
-- Se retira el espejo normalizado de CUPS_PRINCIPAL (pasa a evidencia en
-- source_data) y se persisten el valor normalizado de la prescripcion y el
-- valor derivado que consume la API MIPRES (sin los ultimos 3 digitos).
ALTER TABLE "authorization_items" DROP COLUMN "source_cups_principal_normalized";
ALTER TABLE "authorization_items" ADD COLUMN "source_prescripcion_normalized" varchar(255) DEFAULT '' NOT NULL;
ALTER TABLE "authorization_items" ADD COLUMN "no_prescripcion" varchar(255) DEFAULT '' NOT NULL;
