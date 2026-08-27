# .agent — Plataforma de Autorizaciones y Dispensación

Este directorio es la fuente operativa para agentes de IA que implementen la plataforma.

## Orden de lectura obligatorio

1. `GLOBAL_RULES.md`
2. `DECISIONS_PENDING.md`
3. `IMPLEMENTATION_PLAN.md`
4. ADRs aplicables en `adr/`
5. Spec de la tarea en `specs/`
6. Rol del agente en `agents/`
7. `DEFINITION_OF_DONE.md`

## Regla principal

Un agente **no puede inventar una regla de negocio pendiente**. Si una spec depende de una decisión `PENDING`, o de la porción no resuelta de una decisión `PARTIAL`, puede:
- preparar interfaces, puertos, migraciones reversibles o tests pendientes;
- documentar el bloqueo;
- pero no fijar valores, actores, estados externos, destinatarios ni criterios no confirmados.

## Estrategia de trabajo

- Arquitectura: ADR.
- Comportamiento esperado: SPEC.
- Implementación: código + migraciones + tests.
- Verificación: criterios de aceptación de la SPEC y Definition of Done.
- Toda modificación de una decisión aceptada exige nuevo ADR o reemplazo explícito del ADR anterior.

## Convención de ramas/tareas

Una tarea debe referenciar una spec y, cuando aplique, un ADR:

`spec-003-mipres-directionamientos`

Los commits deben ser pequeños y describir el comportamiento implementado, no el nombre del agente.

## Repositorio objetivo
La implementación se realizará en un repositorio nuevo e independiente de GitHub, estructurado como monorepo.
