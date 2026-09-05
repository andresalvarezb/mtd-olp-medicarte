# ADR-013 — Ingesta por staging antes de producción

**Estado:** ACCEPTED

## Contexto

Un archivo puede contener errores, duplicados o conflictos.

## Decisión

Toda carga crea `import_batch` e `import_rows`. Primero se valida la estructura global; si es interpretable, cada fila se normaliza y valida de forma independiente y luego se confirma a `authorization_items` con una frontera transaccional por fila. Un error de fila no revierte filas válidas; solo un error que impida interpretar el archivo rechaza el lote completo.

## Consecuencias

Se conserva evidencia de rechazados, se puede mostrar un resumen antes de confirmar y se evitan escrituras parciales no auditables. Cada novedad conserva el intento y el historial append-only; los errores internos pueden reprocesarse sin recargar el archivo (ADR-027).
