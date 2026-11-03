# Evidencia inicial: esquema

- `packages/database/src/schema.ts`: modelo Drizzle vigente.
- `packages/database/migrations/meta/_journal.json`: secuencia registrada.
- `packages/database/migrations/`: SQL versionado; inspeccionar las últimas entradas.
- `packages/database/drizzle.config.ts`: configuración de generación.
- `docs/base-de-datos/README.md`
- `docs/base-de-datos/catalogo-generado.md`
- `docs/base-de-datos/schema-index.json`
- `.github/workflows/schema-catalog.yml`: comprobaciones automatizadas del catálogo.

## Casos condicionales

- Constraints o índices no representables: documentar la diferencia entre Drizzle y SQL, y cubrirla con validación estática.
- Backfills: separar población, observación y enforcement; no asumir volumen, locks o duración.
- Seeds versionados: localizar primero el mecanismo existente. Si no existe, no introducir uno ni ejecutar inserts por conveniencia; proponer alcance separado.

Confirmar rutas y buscar dependencias con `rg -n "<tabla|columna>" apps packages tests`. Ejecutar `node --test scripts/db-schema-catalog.test.mjs`, `node scripts/db-schema-catalog.mjs --check` y `pnpm --filter @authorization/database typecheck`; añadir pruebas de consumidores cuando cambien contratos. `pnpm db:generate` puede escribir artefactos y solo corresponde cuando el cambio lo exige y su diff será revisado.
