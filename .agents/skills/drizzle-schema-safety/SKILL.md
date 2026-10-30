---
name: drizzle-schema-safety
description: Coordina cambios persistentes de estructura o datos de referencia versionados en PostgreSQL/Drizzle de Medicarte. Úsala para schema.ts, migraciones, constraints, índices, seeds versionados o catálogo; no para consultas SQL sin cambio de esquema, lógica de repositorio aislada ni correcciones manuales de datos.
---

# Seguridad de esquema Medicarte

**Entrada esperada:** cambio persistente, tablas/columnas afectadas, compatibilidad requerida, volumen/nulabilidad conocidos y orden de despliegue. Si falta evidencia de datos, declárala; no la inventes.

1. Lee `references/evidence.md`; inspecciona `schema.ts`, últimas migraciones y `meta/_journal.json` antes de numerar.
2. Define compatibilidad de lectura/escritura y despliegue. Prefiere cambios aditivos; separa backfill y enforcement cuando corresponda.
3. Mantén alineados Drizzle, SQL versionado, journal y catálogo. Documenta constraints o índices parciales no expresados por Drizzle.
4. Para seeds versionados, exige clave estable, idempotencia, entorno objetivo y política de actualización; no uses una migración como corrección manual de producción.
5. Revisa FK, unicidad, defaults, zona horaria, enums, índices y rollback lógico. No edites migraciones aplicadas para simular una nueva.
6. Ejecuta checks estáticos y pruebas de consumidores indicados en la referencia. No ejecutes migraciones, resets, SQL real ni borres volúmenes sin autorización explícita.

**Finaliza cuando:** el orden de despliegue es compatible, todos los artefactos versionados coinciden, los checks pasan y quedan explícitos riesgos de datos, backfill y rollback.
