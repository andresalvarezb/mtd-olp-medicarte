-- BR-OC-COB-002: clasificacion retroactiva, SOLO LECTURA.
-- Para revisar una AUTO, descomentar el filtro indicado.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';

WITH comercial AS (
  SELECT ai.id AS auto_id,
         ai.numero_autorizacion AS autorizacion,
         ai.codigo_medicamento AS producto,
         po.id AS oc_id,
         po.purchase_order_code AS oc_original,
         po.status AS estado_oc,
         SUM(poas.source_quantity_snapshot)::bigint AS unidades_vinculadas
  FROM purchase_order_authorization_sources poas
  JOIN authorization_items ai
    ON ai.id = poas.authorization_item_id
  JOIN purchase_order_lines pol
    ON pol.id = poas.purchase_order_line_id
   AND pol.commercial_code = ai.codigo_medicamento
  JOIN purchase_orders po
    ON po.id = pol.purchase_order_id
  WHERE poas.released_at IS NULL
    AND po.status NOT IN ('CANCELLED','REJECTED')
    -- AND ai.numero_autorizacion = '262895766412139'
    -- AND ai.codigo_medicamento = '10340'
  GROUP BY ai.id, ai.numero_autorizacion, ai.codigo_medicamento,
           po.id, po.purchase_order_code, po.status
),
reservas AS (
  SELECT authorization_item_id AS auto_id,
         purchase_order_id AS oc_id,
         SUM(
           CASE WHEN status IN ('ALLOCATED','PARTIALLY_CONSUMED')
           THEN GREATEST(
             allocated_quantity-consumed_quantity-released_quantity,0
           ) ELSE 0 END
         )::bigint AS saldo,
         SUM(consumed_quantity)::bigint AS consumidas
  FROM inventory_authorization_allocations
  GROUP BY authorization_item_id, purchase_order_id
),
totals AS (
  SELECT auto_id,
         SUM(saldo) AS saldo_total,
         SUM(consumidas) AS consumidas_total
  FROM reservas GROUP BY auto_id
),
entregas AS (
  SELECT authorization_item_id AS auto_id,
         SUM(quantity)::bigint AS cantidad
  FROM authorization_fulfillments
  WHERE confirmed_at IS NOT NULL AND quantity > 0
  GROUP BY authorization_item_id
),
aplicaciones AS (
  SELECT pa.authorization_item_id AS auto_id,
         SUM(pal.quantity)::bigint AS cantidad
  FROM patient_applications pa
  JOIN patient_application_lines pal
    ON pal.patient_application_id = pa.id
  WHERE pa.status='CONFIRMED'
    AND pa.confirmed_at IS NOT NULL
    AND pa.confirmed_by IS NOT NULL
    AND pal.quantity > 0
  GROUP BY pa.authorization_item_id
),
base AS (
  SELECT c.*,
    COALESCE(r.saldo,0) AS reservado_original,
    GREATEST(
      COALESCE(t.saldo_total,0)-COALESCE(r.saldo,0),0
    ) AS reservado_otras_oc,
    GREATEST(
      COALESCE(t.consumidas_total,0)-COALESCE(r.consumidas,0),0
    ) AS consumido_otras_oc,
    GREATEST(
      CASE WHEN BTRIM(COALESCE(ai.source_data->>'CANTIDAD',''))
           ~ '^[0-9]+$'
      THEN (ai.source_data->>'CANTIDAD')::numeric ELSE 0 END
      - GREATEST(
          COALESCE(e.cantidad,0),
          COALESCE(ap.cantidad,0),
          COALESCE(t.consumidas_total,0)
        ),0
    ) AS pendiente_autorizado
  FROM comercial c
  JOIN authorization_items ai ON ai.id=c.auto_id
  LEFT JOIN reservas r
    ON r.auto_id=c.auto_id AND r.oc_id=c.oc_id
  LEFT JOIN totals t ON t.auto_id=c.auto_id
  LEFT JOIN entregas e ON e.auto_id=c.auto_id
  LEFT JOIN aplicaciones ap ON ap.auto_id=c.auto_id
)
SELECT autorizacion, producto, oc_original, estado_oc,
       unidades_vinculadas, reservado_original,
       reservado_otras_oc, consumido_otras_oc,
       pendiente_autorizado,
  CASE
    WHEN pendiente_autorizado=0 AND consumido_otras_oc>0
      THEN 'ATENDIDA_DESDE_OTRA_OC'
    WHEN pendiente_autorizado>0 AND reservado_original=0
      AND reservado_otras_oc>=pendiente_autorizado
      THEN 'NECESIDAD_CUBIERTA_POR_OTRA_OC'
    WHEN reservado_original>0 AND reservado_otras_oc>0
      THEN 'COBERTURA_CON_VARIAS_OC'
    WHEN reservado_otras_oc>0
      THEN 'COBERTURA_PARCIAL_OTRA_OC'
    ELSE 'SIN_COBERTURA_EXTERNA'
  END AS clasificacion,
  COUNT(*) OVER () AS relaciones_detectadas
FROM base
WHERE reservado_otras_oc>0 OR consumido_otras_oc>0
ORDER BY autorizacion, producto, oc_original
LIMIT 500;

COMMIT;
