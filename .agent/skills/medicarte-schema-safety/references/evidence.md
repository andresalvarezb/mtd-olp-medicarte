# Evidencia inicial: esquema

- `packages/database/src/schema.ts`: modelo Drizzle vigente.
- `packages/database/migrations/meta/_journal.json`: secuencia registrada.
- `packages/database/migrations/`: SQL versionado; inspeccionar las últimas entradas.
- `packages/database/drizzle.config.ts`: configuración de generación.
- `docs/base-de-datos/README.md`
- `docs/base-de-datos/catalogo-generado.md`
- `docs/base-de-datos/schema-index.json`
- `.github/workflows/schema-catalog.yml`: comprobaciones automatizadas del catálogo.

Confirmar las rutas vigentes antes de editar y buscar dependencias por tabla, columna y contrato.
