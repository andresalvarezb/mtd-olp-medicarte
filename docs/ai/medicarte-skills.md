# Skills de agentes específicas de Medicarte

Las skills locales viven en `.agents/skills` y capturan procedimientos que requieren conocimiento del código, ADR y pruebas de este repositorio. No añaden reglas de Medicarte al toolkit central `codex-skill-engineering`.

| Skill                         | Activación                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `medicarte-flow-integrity`    | Cambios de estados, cantidades o enlaces del flujo; imports y conciliaciones operativas          |
| `medicarte-access-boundaries` | Cambios de enforcement o visibilidad por RBAC, organización, punto, IDOR o procesos masivos      |
| `medicarte-schema-safety`     | Cambios persistentes de esquema, migraciones, constraints, índices, seeds versionados o catálogo |

No activar estas skills por cambios exclusivos de presentación, consultas SQL sin cambio de esquema ni documentación ajena al flujo. Si una tarea cruza fronteras —por ejemplo, un import masivo con point scope— aplicar todas las skills correspondientes.

Validación local segura: `node scripts/validate-medicarte-skills.mjs`. El validador sólo lee archivos; no conecta a bases de datos ni ejecuta migraciones.
