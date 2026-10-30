# Reglas para agentes — MTD OLP Medicarte

## Base y seguridad

- La rama base operativa es `develop`. Las ramas de trabajo y los pull requests deben incluir `origin/develop` y apuntar a `develop`, nunca a `master` ni `main`.
- Antes de editar, revisar `git status --short --branch`, remoto y ancestro. No descartar cambios locales ni operar contra producción.
- Las reglas específicas viven en `.agents/skills/`; el toolkit `codex-skill-engineering` debe permanecer agnóstico de Medicarte.

## Skills obligatorias por alcance

- Usar `medicarte-flow-integrity` para autorizaciones, órdenes, recepciones, inventario, asignaciones o consumos.
- Usar `medicarte-access-boundaries` para identidad, roles, permisos, organizaciones, puntos, listados o recursos por id.
- Usar `medicarte-schema-safety` para `packages/database`, SQL, migraciones, constraints o catálogo de base de datos.
- Si un cambio cruza áreas, aplicar todas las skills correspondientes. Las referencias son puntos de partida: contrastarlas con el código y pruebas actuales.

## Cierre

Ejecutar pruebas enfocadas y controles proporcionales; revisar el diff; informar archivos, resultados y riesgos. No ejecutar migraciones, resets, despliegues ni accesos a producción como parte de la validación.
