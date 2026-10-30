---
name: requirements-implementation
description: Implementa requerimientos funcionales aprobados de Medicarte (RF, BR, historia o ADR) contrastándolos con el código y pruebas existentes. Úsala al desarrollar, ejecutar o aplicar un requerimiento; no al solo documentarlo, revisarlo, estimarlo o diagnosticar su cobertura sin cambios.
---

# Implementar un requerimiento Medicarte

**Entrada esperada:** ID, ruta o descripción de un requerimiento aprobado. Si solo se proporciona el ID, buscarlo primero en `docs/requirements/`.

1. **Delimitar:** leer reglas y criterios de aceptación; separar decisiones aprobadas, pendientes y comportamiento vigente. Si una ambigüedad cambia dinero, permisos, datos, cantidades o estados irreversibles, detener esa parte y solicitar la decisión.
2. **Respetar el proyecto:** inspeccionar `git status --short --branch`, `AGENTS.md` y convenciones locales; preservar cambios existentes. Activar también las skills de dominio que correspondan al alcance.
3. **Descubrir selectivamente:** extraer actores, operaciones, entidades, estados, identificadores y casos negativos. Usar `rg --files`, `rg -l` y `rg -n` para seguir solo el flujo relevante desde entrada/interfaz hasta contrato, API, servicio, persistencia, jobs y pruebas. Abrir [references/discovery-playbook.md](references/discovery-playbook.md) solo si los puntos de implementación no son evidentes.
4. **Contrastar:** mantener un mapa breve `criterio → comportamiento existente → brecha → archivos/pruebas`. Si ya está implementado, informar evidencia y no producir cambios artificiales.
5. **Implementar:** modificar el conjunto mínimo coherente de código, contratos, interfaz, datos y pruebas. Conservar permisos, organización/punto, estados, cantidades, concurrencia, idempotencia, auditoría e histórico aplicables.
6. **Verificar proporcionalmente:** ejecutar primero pruebas dirigidas por criterio con éxito, rechazo y regresión; ampliar a typecheck, lint, build, integración o migraciones en base aislada según el riesgo. Revisar `git diff --check` y el diff completo.
7. **Entregar:** informar criterios satisfechos, rutas cambiadas, pruebas realmente ejecutadas, riesgos pendientes y estado Git.

**Límites:** no acceder ni modificar producción; no ejecutar resets, migraciones reales o despliegues ni revelar secretos. No descartar cambios locales ni hacer commit, push, PR o merge salvo autorización explícita. Para documentar o aclarar el requerimiento sin implementarlo, usar `requirements-documentation`.
