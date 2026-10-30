# Skills de agentes específicas de Medicarte

Las skills locales viven en `.agents/skills` y capturan procedimientos que requieren conocimiento del código, ADR y pruebas de este repositorio. No añaden reglas de Medicarte al toolkit central `codex-skill-engineering`.

| Skill                         | Activación                                                             |
| ----------------------------- | ---------------------------------------------------------------------- |
| `medicarte-flow-integrity`    | Autorizaciones, órdenes, recepciones, inventario, asignación o consumo |
| `medicarte-access-boundaries` | Roles, permisos, organizaciones, puntos, IDOR o procesos masivos       |
| `medicarte-schema-safety`     | Esquema, migraciones, constraints, índices o catálogo de BD            |

Validación local segura: `node scripts/validate-medicarte-skills.mjs`. El validador sólo lee archivos; no conecta a bases de datos ni ejecuta migraciones.
