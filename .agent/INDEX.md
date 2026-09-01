# Índice de ejecución por fase

| Fase | Specs principales                                                | ADRs principales                                | Agentes                                       |
| ---- | ---------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| F0   | DECISIONS_PENDING, F0_CLOSURE, contratos de importacion y MIPRES | 005,006,008,009,013,016,017,018,019,020,021,022 | Orchestrator + Architect                      |
| F1   | SPEC-008, 009, 010                                               | 002,003,004,007,011,012,014,015,016,017,026     | Architect, Backend, QA, Security              |
| F2   | SPEC-001,002                                                     | 003,009,013,015,016,021                         | Backend, Frontend, QA                         |
| F3   | SPEC-003,009                                                     | 004,008,014                                     | Backend, Integrations, QA                     |
| F4   | SPEC-002,004,009,011,013                                         | 006,009,014,020,021,022                         | Backend, Integrations, Frontend, QA, Security |
| F5   | SPEC-002,005,008,009,013                                         | 005,007,009,016,018,022                         | Backend, Frontend, QA, Security               |
| F6   | SPEC-002,006,008,010                                             | 003,007,009,016                                 | Backend, Frontend, QA, Security               |

## Regla

El orquestador asigna tareas por SPEC, no por “haz el backend completo”. Las tareas deben poder verificarse de forma independiente.

## Dependencias F0

- `.agent/contracts/AUTHORIZATION_IMPORT_DATA_DICTIONARY.md`: contrato aceptado de las 26 columnas y causales de carga; versión 2 con clasificación por `No.PRESCRIPCION` (DEC-016).
- `.agent/contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`: contrato externo `ACCEPTED` por DEC-013; autoriza el alcance de solo lectura de Fase 3.
- Specs afectadas: SPEC-001, 002, 003, 004, 005, 006, 008, 009, 011, 012 y 013.
- Agentes: Orchestrator y Architect.

- ADR-018: exportaciones CSV/XLSX bajo demanda, sin persistencia del archivo generado.

- DEC-010: repositorio nuevo e independiente en GitHub, monorepo.

- ADR-019: repositorio GitHub independiente en monorepo.

- ADR-020: `lugar_dispensacion` como dato logístico versionado y estado derivado.
- ADR-022: pipeline genérico de actualizaciones operativas masivas.
- SPEC-011: carga masiva del lugar y notificación posterior a OLP.
- SPEC-013: descargas completas, contratos reducidos, APIs, staging y causales por fila.
- SPEC-012: alcance multi-organización de autorizaciones sin duplicar el registro principal.
- DEC-012: autorización global compartida y relación explícita por organización.
