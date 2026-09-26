-- AT: cantidad mínima de producto.
--
-- Regla operacional:
-- una AUTO no supera la validación inicial cuando
-- CANTIDAD < tariff_annex_products.minimum_quantity.
--
-- Los productos no configurados explícitamente conservan mínimo 1.

ALTER TABLE tariff_annex_products
ADD COLUMN IF NOT EXISTS minimum_quantity integer NOT NULL DEFAULT 1;

ALTER TABLE tariff_annex_products
DROP CONSTRAINT IF EXISTS tariff_annex_products_minimum_quantity_check;

ALTER TABLE tariff_annex_products
ADD CONSTRAINT tariff_annex_products_minimum_quantity_check
CHECK (minimum_quantity > 0);


-- Snapshot de revisiones futuras del AT.
ALTER TABLE tariff_product_revisions
ADD COLUMN IF NOT EXISTS minimum_quantity integer NOT NULL DEFAULT 1;

ALTER TABLE tariff_product_revisions
DROP CONSTRAINT IF EXISTS tariff_product_revisions_minimum_quantity_check;

ALTER TABLE tariff_product_revisions
ADD CONSTRAINT tariff_product_revisions_minimum_quantity_check
CHECK (minimum_quantity > 0);


-- Los snapshots históricos anteriores a esta regla pueden quedar NULL:
-- en ese momento la regla de mínimo todavía no existía.
ALTER TABLE authorization_tariff_snapshots
ADD COLUMN IF NOT EXISTS minimum_quantity integer;

ALTER TABLE authorization_tariff_snapshots
DROP CONSTRAINT IF EXISTS authorization_tariff_snapshots_minimum_quantity_check;

ALTER TABLE authorization_tariff_snapshots
ADD CONSTRAINT authorization_tariff_snapshots_minimum_quantity_check
CHECK (
  minimum_quantity IS NULL
  OR minimum_quantity > 0
);


-- Fuente: UNIDAD MINIMA.xlsx suministrado para este requerimiento.
WITH minimums (
  codigo_producto,
  minimum_quantity
) AS (
  VALUES
    ('12633', 1),
    ('11367', 1),
    ('11368', 1),
    ('GH0034', 1),
    ('12690', 1),
    ('12937', 1),
    ('10342', 1),
    ('RC0052', 30),
    ('10670', 56),
    ('10156', 30),
    ('10946', 28),
    ('10157', 30),
    ('10947', 28),
    ('10777', 1),
    ('PX0091', 1),
    ('11055', 1),
    ('11057', 1),
    ('11058', 1),
    ('LL0054', 1),
    ('10340', 1),
    ('10341', 1),
    ('11043', 1),
    ('10163', 1),
    ('11045', 1),
    ('11061', 1),
    ('11263', 1),
    ('11262', 1),
    ('10703', 1),
    ('CHALV01', 1),
    ('TF0001', 1),
    ('TF0055', 1),
    ('BR0045', 1),
    ('BR0046', 1),
    ('RC0048', 1),
    ('RC0067', 1),
    ('ORP006', 60),
    ('ORP010', 60),
    ('10822', 1),
    ('10823', 1),
    ('10821', 1),
    ('10824', 1),
    ('10819', 1),
    ('10820', 1),
    ('ORP007', 1),
    ('ORP008', 1),
    ('ORP009', 1),
    ('10831', 1),
    ('10832', 1),
    ('11811', 1),
    ('EUF076', 30),
    ('11169', 100),
    ('11170', 100),
    ('10517', 1),
    ('PX0095', 1),
    ('PX0075', 1),
    ('PX0096', 1),
    ('PX0076', 1),
    ('12654', 100),
    ('12655', 50),
    ('12663', 50),
    ('12665', 50),
    ('BSD004', 30),
    ('13346', 1),
    ('HU0064', 1),
    ('10598', 1),
    ('HU0144', 1),
    ('10599', 1),
    ('BP0080', 1),
    ('BP0015', 1),
    ('HU0098', 1),
    ('10597', 1),
    ('TF0034', 1),
    ('TF0072', 1),
    ('VT0002', 1),
    ('PX0126', 1),
    ('10217', 1),
    ('10522', 1),
    ('LL0014', 1)
)

UPDATE tariff_annex_products product
SET minimum_quantity =
      minimums.minimum_quantity
FROM minimums
WHERE upper(btrim(product.codigo_producto)) =
      minimums.codigo_producto;
