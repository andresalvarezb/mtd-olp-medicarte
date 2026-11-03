---
name: requirements-documentation
description: Documenta, aclara o actualiza requerimientos funcionales de Medicarte en docs/requirements, con reglas, criterios de aceptación, decisiones y trazabilidad verificables. Úsala al redactar o formalizar un RF, BR o historia; no para implementar código, auditar cumplimiento técnico en solo lectura ni hacer correcciones editoriales generales.
---

# Documentar requerimientos Medicarte

**Entrada esperada:** ID o propósito, decisión funcional conocida y alcance. Si una decisión afecta dinero, permisos, datos, cantidades o estados y no está aprobada, registrarla como pendiente; no resolverla por inferencia.

1. Inspecciona `git status --short --branch`, `AGENTS.md` y `docs/requirements/`. Conserva cambios locales y busca primero el documento por ID antes de crear otro.
2. Reúne evidencia selectiva: abre `docs/flujo-mtd.md`, requerimientos relacionados y solo las rutas de código o contratos necesarias para distinguir comportamiento vigente de intención nueva. No hagas una exploración general del repositorio.
3. Redacta el cambio mínimo en `docs/requirements/<ID>-<slug>.md`. Separa con claridad objetivo, alcance, actores, reglas e invariantes, criterios de aceptación observables, fuera de alcance, decisiones pendientes y evidencia técnica cuando aplique. Conserva el estilo útil del documento existente en vez de imponer una plantilla rígida.
4. No presentes como implementada una regla que solo está aprobada. Detecta contradicciones con otros documentos y resuélvelas únicamente cuando exista una decisión explícita; de lo contrario, enlázalas como pendientes.
5. Activa las skills locales de dominio si el requerimiento toca flujo de compra/entrega, RBAC/puntos o esquema persistente. Úsalas para formular invariantes y riesgos, no para implementar el requerimiento.
6. Revisa enlaces, IDs, fechas, ejemplos y trazabilidad; ejecuta `git diff --check` y confirma que el diff no contiene código ni documentos ajenos al alcance.

**Finaliza cuando:** el documento permite implementar y probar sin inventar reglas, las decisiones pendientes están visibles y se informan archivos cambiados y validaciones realizadas.

**Límites:** no modificar código, migraciones ni producción. No descartar trabajo local ni hacer commit, push, PR o merge salvo autorización explícita. Esta skill documenta; `requirements-implementation` ejecuta un requerimiento aprobado.
