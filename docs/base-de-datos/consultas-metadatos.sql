-- Consultas estructurales y de SOLO LECTURA para PostgreSQL.
-- No devuelve filas de pacientes, medicamentos o usuarios, solo metadatos.
-- Ejecutar en conexión autorizada de desarrollo/integración.
-- Para pgAdmin/psql: ejecutar SELECTs aislados y sustituir valores en WHERE.
BEGIN TRANSACTION READ ONLY;

-- 1. Tablas base presentes realmente en el esquema activo.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 2. Columnas de una tabla. Cambiar 'purchase_orders' por el objetivo.
SELECT ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'purchase_orders'
ORDER BY ordinal_position;

-- 3. Claves primarias, foráneas, UNIQUE y CHECK de una tabla.
-- pg_get_constraintdef ayuda a entender la estructura exacta instalada.
SELECT con.conname AS constraint_name,
       con.contype AS constraint_type,
       pg_get_constraintdef(con.oid, TRUE) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = current_schema() AND rel.relname = 'purchase_orders'
ORDER BY con.contype, con.conname;

-- 4. Relaciones FK salientes y entrantes de una tabla.
SELECT rel.relname AS source_table,
       con.conname AS foreign_key_name,
       target.relname AS target_table,
       pg_get_constraintdef(con.oid, TRUE) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_class target ON target.oid = con.confrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE con.contype = 'f'
  AND ns.nspname = current_schema()
  AND ('purchase_orders' IN (rel.relname, target.relname))
ORDER BY source_table, target_table, foreign_key_name;

-- 5. Índices físicos de una tabla.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'purchase_orders'
ORDER BY indexname;

ROLLBACK;
