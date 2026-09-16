-- TASK-NOV-001: garantía PostgreSQL de máximo una ocurrencia activa por
-- identidad lógica (fase 2). NO se registra en meta/_journal.json: debe
-- aplicarse manualmente (agregando su entrada al journal) únicamente después
-- de ejecutar scripts/reconcile-novelties.mjs --apply y verificar
-- cero duplicados activos por logical_key.
CREATE UNIQUE INDEX IF NOT EXISTS "novelties_logical_key_active_unique"
  ON "novelties" ("logical_key")
  WHERE "active" = true;
