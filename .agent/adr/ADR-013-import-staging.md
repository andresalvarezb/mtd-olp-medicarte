# ADR-013 — Ingesta por staging antes de producción

**Estado:** ACCEPTED

## Contexto

Un archivo puede contener errores, duplicados o conflictos.

## Decisión

Toda carga crea `import_batch` e `import_rows`. Primero se normaliza/valida; luego se confirma a `authorization_items`.

## Consecuencias

Se conserva evidencia de rechazados, se puede mostrar un resumen antes de confirmar y se evitan escrituras parciales no auditables.
