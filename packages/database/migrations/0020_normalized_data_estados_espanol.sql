-- Normalizar las clasificaciones JSON de filas históricas. Estas estructuras
-- se vuelven a validar al consultar el reporte de filas de una importacion.

UPDATE "import_rows"
SET "normalized_data" = jsonb_set(
  jsonb_set(
    "normalized_data",
    '{enablementStatus}',
    to_jsonb(CASE "normalized_data"->>'enablementStatus'
      WHEN 'ENABLED' THEN 'HABILITADO'
      WHEN 'BLOCKED_SOURCE_STATUS' THEN 'BLOQUEADO_POR_ESTADO_ORIGEN'
      ELSE "normalized_data"->>'enablementStatus'
    END),
    true
  ),
  '{directionStatus}',
  to_jsonb(CASE "normalized_data"->>'directionStatus'
    WHEN 'NOT_APPLICABLE' THEN 'NO_APLICA'
    WHEN 'PENDING' THEN 'PENDIENTE'
    WHEN 'CONFIRMED' THEN 'CONFIRMADO'
    WHEN 'QUERY_ERROR' THEN 'ERROR_DE_CONSULTA'
    ELSE "normalized_data"->>'directionStatus'
  END),
  true
)
WHERE "normalized_data" IS NOT NULL;--> statement-breakpoint

UPDATE "import_rows"
SET "normalized_data" = jsonb_set(
  "normalized_data",
  '{operationStatus}',
  CASE
    WHEN "normalized_data"->>'operationStatus' IS NULL THEN 'null'::jsonb
    ELSE to_jsonb(CASE "normalized_data"->>'operationStatus'
      WHEN 'BLOCKED' THEN 'BLOQUEADO'
      WHEN 'READY_TO_DISPENSE' THEN 'LISTO_PARA_DISPENSAR'
      WHEN 'DISPENSATION_REPORTED' THEN 'DISPENSACION_REPORTADA'
      WHEN 'DISPENSED' THEN 'DISPENSADO'
      WHEN 'EXPIRED' THEN 'VENCIDO'
      ELSE "normalized_data"->>'operationStatus'
    END)
  END,
  true
)
WHERE "normalized_data" IS NOT NULL;
