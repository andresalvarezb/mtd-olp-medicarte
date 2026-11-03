---
name: requirements-implementation
description: Implementa requerimientos funcionales aprobados de Medicarte (RF, BR, historia o ADR) contrastándolos con código y pruebas. Úsala al desarrollar o aplicar un requerimiento; no al solo documentarlo, revisarlo, estimarlo o diagnosticarlo sin cambios.
---

# Implementar un requerimiento Medicarte

**Entrada:** ID, ruta o descripción de un requerimiento aprobado; resolver el ID primero en `docs/requirements/`.

1. **Delimitar:** leer criterios, decisiones aprobadas y pendientes. Si una ambigüedad afecta dinero, permisos, datos, cantidades o estados irreversibles, detener esa parte y solicitar decisión.
2. **Respetar el proyecto:** comprobar estado Git, `AGENTS.md` y skills del dominio afectado. Preservar el trabajo existente.
3. **Descubrir por impacto:** buscar primero símbolos y rutas derivados del RF (`rg --files`, `rg -l`, `rg -n`); abrir solo los fragmentos necesarios y expandir una dependencia a la vez cuando haya evidencia. Evitar volver a leer archivos ya analizados. Usar [discovery-playbook](references/discovery-playbook.md) solo si no son evidentes las rutas.
4. **Contrastar y planear pruebas ANTES de editar:** mantener mapa breve `criterio → evidencia actual → brecha → rutas → prueba`. Clasificar riesgos (UI, acceso, esquema, estados, inventario, dinero, concurrencia), identificar fixtures sintéticos y entorno aislado necesarios. Consultar [riesgo y continuidad](references/risk-and-continuity.md) únicamente si hay riesgo alto, pruebas de integración o tarea prolongada. Si está cumplido, no introducir cambios artificiales.
5. **Implementar:** editar el conjunto mínimo coherente, preservando las invariantes y activando las skills especializadas cuando aplique.
6. **Verificar:** comenzar con pruebas focalizadas positivas y negativas; ampliar a regresión, integración real, concurrencia, typecheck o migraciones en TEST según riesgo. Revisar diff y `git diff --check`; nunca usar producción.
7. **Continuar sin repetir:** al terminar una fase importante o prever interrupción, guardar un checkpoint mínimo en `.codex/work-progress/<ID>.md` SOLO si `git check-ignore` confirma que está excluido; si no, añadir la ruta a `.git/info/exclude` local antes de escribir. Incluir estado Git/HEAD, decisiones, rutas, evidencia de pruebas y siguiente paso, sin secretos ni datos personales. Al reanudar, contrastar checkpoint con Git y pruebas, nunca asumir vigencia. No actualizarlo en cada comando.
8. **Entregar:** resumir criterios verificados, archivos, comandos y resultados reales, riesgos y pendientes. Diferenciar métricas reales de tokens de estimaciones.

**Límites:** no acceder ni modificar producción, revelar secretos, descartar trabajo local ni hacer commit/push/PR/merge sin autorización. Para solo documentar o aclarar, usar `requirements-documentation`.
