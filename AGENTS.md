# Reglas para agentes — MTD OLP Medicarte

## Base y seguridad

- La rama base operativa es `develop`. Las ramas de trabajo y los pull requests deben incluir `origin/develop` y apuntar a `develop`, nunca a `master` ni `main`.
- Antes de editar, revisar `git status --short --branch`, remoto y ancestro. No descartar cambios locales ni operar contra producción.
- Las reglas específicas viven en `.agents/skills/`; la metodología universal `agent-skill-engineering` debe permanecer agnóstica de Medicarte.

## Skills obligatorias por alcance

- Usar `requirements-documentation` al crear, aclarar o actualizar un requerimiento funcional; no al implementarlo ni para edición documental general.
- Usar `requirements-implementation` al desarrollar un requerimiento aprobado; no para documentarlo, revisarlo o estimarlo sin cambios.
- Usar `patient-master-integrity` cuando cambien la identidad maestra de pacientes, sus enlaces históricos, backfill/conciliación, sincronización MTDOM o consumidores migrados bajo RF-PAC-001/RF-PAC-002; no por rutas que solo incluyan `patient`.
- Usar `purchase-fulfillment-integrity` cuando cambien estados, cantidades o enlaces entre autorizaciones, órdenes, recepciones, inventario, asignaciones y consumos, incluidos imports o conciliaciones de esa cadena.
- Usar `rbac-point-scope` cuando cambien enforcement o visibilidad por identidad, roles, organizaciones, puntos, listados, recursos por id u operaciones masivas.
- Usar `drizzle-schema-safety` para cambios persistentes en `schema.ts`, migraciones, constraints, índices, seeds versionados o catálogo; no por una consulta SQL aislada.
- Usar `local-test-environments` al preparar, reutilizar, coordinar en paralelo o limpiar entornos locales de integración con servicios compartidos; no para pruebas unitarias, CI, `prodshadow` ni despliegues remotos.
- Si un cambio cruza áreas, aplicar todas las skills correspondientes. Las referencias son puntos de partida: contrastarlas con el código y pruebas actuales.

## Cierre

Ejecutar pruebas enfocadas y controles proporcionales; revisar el diff; informar archivos, resultados y riesgos. Nunca desplegar ni acceder a producción como parte de la validación. Las pruebas enfocadas de integración pueden aplicar migraciones y eliminar volúmenes solo mediante el runner predeterminado, dentro de su proyecto Compose efímero propio después de verificar que está vacío. No ejecutes esas operaciones manualmente ni contra proyectos persistentes o ajenos. Los modos reutilizables y la instancia persistente `db:test` siguen las autorizaciones indicadas abajo.

## Validación progresiva

- En PowerShell usa `pnpm.cmd` para evitar depender de la política de ejecución de `pnpm.ps1`. Empieza por las pruebas enfocadas: `pnpm.cmd test:focused -- apps/api/src/ruta/archivo.test.ts` (admite varios archivos explícitos bajo `apps/` o `packages/`).
- Para integración, selecciona archivos bajo `tests/integration/`: `pnpm.cmd test:integration:focused -- tests/integration/archivo.test.ts`. El modo predeterminado crea y verifica un proyecto Compose efímero propio, ejecuta sus migraciones y elimina sus volúmenes al terminar. Esta es la única excepción automática para migraciones y limpieza durante validación.
- Para iterar localmente, prepara una sola vez el proyecto `mtd-olp-medicarte-integration-<uuid>` con puertos aislados y después reutilízalo: configura `INTEGRATION_REUSE=1`, `INTEGRATION_COMPOSE_PROJECT_NAME`, `POSTGRES_HOST_PORT=25432`, `REDIS_HOST_PORT=26379`, `API_HOST_PORT=3003` y `DATABASE_URL=postgresql://authorization:authorization@localhost:25432/authorization_test_integration`. El runner verifica servicios, puerto, credenciales, nombre de base y la identidad PostgreSQL antes de probar; no elimina volúmenes, pero ejecuta `db:reset --yes` y trunca los datos operacionales. Antes de cada uso, informa ese efecto y solicita autorización explícita; si no la hay, no ejecutes el modo reusable. Para detenerlo, usa el mismo proyecto/archivo Compose y `down` sin `-v`.
- La instancia `db:test` es persistente. `db:test:migrate`, `db:test:seed` y `db:test:check` escriben datos; `db:test:setup` ejecuta las tres operaciones, y `check` agrega eventos financieros sintéticos append-only. Requieren autorización explícita antes de ejecutarse. `db:test:verify` es de solo lectura. No uses `db:reset`, `integration:setup` ni `down -v` contra esa instancia.
- Corre typecheck/lint focalizados cuando corresponda. En PowerShell ejecuta `pnpm.cmd build`, `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, integración completa y E2E solo cuando el cambio afecte sus contratos o una revisión/CI completa lo requiera.
- No repitas una suite completa que ya pasó salvo cambio en su alcance/dependencias, fallo posterior relacionado o requisito explícito de CI/revisión. No paralelices suites con estado compartido sin demostrar su independencia.
- Mantén todos los jobs y controles completos de GitHub Actions; los comandos enfocados son para el ciclo local.

## graphify

Usa la CLI de Graphify si una tarea cruza módulos, sigue un flujo o requiere análisis de impacto; omítela en cambios aislados. Comprueba `graphify --version`; `graphify update .` actualiza el grafo local e incremental y `graphify path`, `graphify explain` y `graphify query` sirven para navegación focalizada. Tras cambios estructurales, actualízalo y conserva `graphify-out/` fuera de Git. Contrasta cada relación en código y pruebas porque las aristas inferidas no demuestran comportamiento. Si la CLI o el grafo no están disponibles, continúa con búsquedas dirigidas e informa la limitación.
