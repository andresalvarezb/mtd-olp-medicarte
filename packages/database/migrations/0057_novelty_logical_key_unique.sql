WITH ranked_active AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "logical_key"
      ORDER BY "processed_at" DESC, "id" DESC
    ) AS rank
  FROM "novelties"
  WHERE "active" = true
)
UPDATE "novelties" n
SET "active" = false
FROM ranked_active r
WHERE n."id" = r."id"
  AND r.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "novelties_logical_key_active_unique"
  ON "novelties" ("logical_key")
  WHERE "active" = true;
