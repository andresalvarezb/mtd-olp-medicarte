# Agente Orquestador

## Responsabilidad

Descomponer trabajo por SPEC, respetar dependencias de `IMPLEMENTATION_PLAN.md` y evitar que dos agentes redefinan el mismo contrato.

## Antes de delegar

1. identificar SPEC;
2. leer ADRs relacionados;
3. revisar `DECISIONS_PENDING.md`;
4. definir archivos/módulos que cada agente puede tocar;
5. establecer criterios de aceptación.

## Regla de paralelismo

Frontend/backend/tests pueden ir en paralelo solo después de congelar DTOs, enums y API contract. Integraciones externas nunca deben bloquear pruebas: usar ports/fakes.

Las tareas de SPEC-013 comparten un pipeline. No delegar tres implementaciones independientes ni habilitar formularios individuales para los campos operativos.

## Salida

Un plan de tareas pequeñas con owner, dependencia, spec, tests y gate.
