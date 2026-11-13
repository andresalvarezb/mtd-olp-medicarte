# Skills de agentes específicas de Medicarte

Las diez skills locales viven en `.agents/skills/` y capturan procedimientos que requieren conocimiento del código, ADR y pruebas de este repositorio. La metodología universal `agent-skill-engineering` permanece agnóstica de Medicarte.

| Skill | Activación | Exclusión principal |
| --- | --- | --- |
| `requirements-documentation` | Crear o aclarar un RF | Implementación o edición general |
| `requirements-implementation` | Desarrollar un RF aprobado | Revisión o estimación sin cambios |
| `patient-master-integrity` | Identidad, enlaces y MTDOM bajo RF-PAC-001/002 | Ruta que solo contiene `patient` |
| `purchase-fulfillment-integrity` | Estados, cantidades y enlaces de autorización a consumo | Presentación aislada |
| `financial-integrity` | Recaudos, devoluciones, saldos y eventos financieros | Logística sin efecto financiero |
| `exportables-contract-integrity` | Contrato de filas/columnas Excel o CSV | Vista que no cambia el archivo |
| `production-data-safety` | Diagnóstico o propuesta de corrección de registros reales | SELECT explicativo o esquema versionado |
| `rbac-point-scope` | Permiso y visibilidad por organización/punto | UI sin cambio de acceso |
| `drizzle-schema-safety` | Esquema, migraciones y datos de referencia versionados | SQL de solo lectura o corrección manual |
| `local-test-environments` | Coordinar servicios y bases locales de integración | Unitarias puras, CI y producción |

Si una tarea cruza fronteras, aplicar solo las skills implicadas. Un exportable limitado por punto combina `exportables-contract-integrity` y `rbac-point-scope`; una devolución real con corrección de datos combina `financial-integrity` y `production-data-safety`. Una corrección visual aislada no activa skills de negocio. Las referencias son puntos de partida que deben contrastarse con código y pruebas actuales.

`production-data-safety` no concede autorización para conectarse a producción o ejecutar SQL. Las propuestas requieren revisión y autorización operativa explícita. Para cambios estructurales versionados corresponde `drizzle-schema-safety`.

Validación estática de solo lectura: `node scripts/validate-medicarte-skills.mjs`. La matriz `evals/medicarte-skills.cases.json` define expectativas, no resultados de activación; las corridas reales e históricas se distinguen en `docs/ai/medicarte-skills-evaluation.md`.
