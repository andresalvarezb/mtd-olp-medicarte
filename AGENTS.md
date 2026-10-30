# Reglas para agentes — MTD OLP Medicarte

## Base y seguridad

- La rama base operativa es `develop`. Las ramas de trabajo y los pull requests deben incluir `origin/develop` y apuntar a `develop`, nunca a `master` ni `main`.
- Antes de editar, revisar `git status --short --branch`, remoto y ancestro. No descartar cambios locales ni operar contra producción.
- Las reglas específicas viven en `.agents/skills/`; el toolkit `codex-skill-engineering` debe permanecer agnóstico de Medicarte.

## Skills obligatorias por alcance

- Usar `purchase-fulfillment-integrity` cuando cambien estados, cantidades o enlaces entre autorizaciones, órdenes, recepciones, inventario, asignaciones y consumos, incluidos imports o conciliaciones de esa cadena.
- Usar `rbac-point-scope` cuando cambien enforcement o visibilidad por identidad, roles, organizaciones, puntos, listados, recursos por id u operaciones masivas.
- Usar `drizzle-schema-safety` para cambios persistentes en `schema.ts`, migraciones, constraints, índices, seeds versionados o catálogo; no por una consulta SQL aislada.
- Si un cambio cruza áreas, aplicar todas las skills correspondientes. Las referencias son puntos de partida: contrastarlas con el código y pruebas actuales.

## Cierre

Ejecutar pruebas enfocadas y controles proporcionales; revisar el diff; informar archivos, resultados y riesgos. No ejecutar migraciones, resets, despliegues ni accesos a producción como parte de la validación.
