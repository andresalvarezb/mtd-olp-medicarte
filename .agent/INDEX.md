# Índice de ejecución por fase

| Fase | Specs principales                                                | ADRs principales                            | Agentes                                       |
| ---- | ---------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| F0   | DECISIONS_PENDING, F0_CLOSURE, contratos de importacion y MIPRES | 005,006,008,009,013,016,017,018,019,020,021 | Orchestrator + Architect                      |
| F1   | SPEC-008, 009, 010                                               | 002,003,004,007,011,012,014,015,016,017     | Architect, Backend, QA, Security              |
| F2   | SPEC-001,002                                                     | 003,009,013,015,016,021                     | Backend, Frontend, QA                         |
| F3   | SPEC-003,009                                                     | 004,008,014                                 | Backend, Integrations, QA                     |
| F4   | SPEC-002,004,009                                                 | 006,009,014,021                             | Backend, Integrations, Frontend, QA           |
| F5   | SPEC-005,008                                                     | 005,007,009,016                             | Backend, Integrations, Frontend, QA, Security |
| F6   | SPEC-006,008,010                                                 | 003,007,009,016                             | Backend, Frontend, QA, Security               |
| F7   | SPEC-007,009                                                     | 004,010,014                                 | Backend, Integrations, QA                     |

## Regla

El orquestador asigna tareas por SPEC, no por “haz el backend completo”. Las tareas deben poder verificarse de forma independiente.

## Dependencias F0

- `.agent/contracts/AUTHORIZATION_IMPORT_DATA_DICTIONARY.md`: contrato aceptado de las 25 columnas y causales de carga.
- `.agent/contracts/MIPRES_DIRECCIONAMIENTOS_SANDBOX.md`: contrato externo `PENDING`; bloquea la implementacion real de Fase 3.
- Specs afectadas: SPEC-001, 002, 003, 004, 005, 006, 011 y 012.
- Agentes: Orchestrator y Architect.

- ADR-018: exportaciones CSV/XLSX bajo demanda, sin persistencia del archivo generado.

- DEC-010: repositorio nuevo e independiente en GitHub, monorepo.

- ADR-019: repositorio GitHub independiente en monorepo.

- ADR-020: punto de aplicación como etapa logística explícita entre disponibilidad y aplicación.
- SPEC-011: asignación/versionado del punto de aplicación y segunda notificación a OLP.
- SPEC-012: alcance multi-organización de autorizaciones sin duplicar el registro principal.
- DEC-012: autorización global compartida y relación explícita por organización.
