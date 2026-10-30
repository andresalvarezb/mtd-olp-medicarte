---
name: medicarte-schema-safety
description: Coordina cambios seguros de esquema PostgreSQL/Drizzle en Medicarte. Úsala para schema.ts, migraciones, constraints, índices, seeds y catálogo generado.
---

# Seguridad de esquema Medicarte

1. Lee `references/evidence.md`; inspecciona `schema.ts`, la última migración y `meta/_journal.json` antes de asignar un número.
2. Define compatibilidad de lectura/escritura y orden de despliegue. Prefiere cambios aditivos; separa backfill y enforcement cuando el volumen o la nulabilidad lo exijan.
3. Mantén alineados esquema Drizzle, SQL versionado, journal y documentación generada. Documenta constraints o índices parciales que Drizzle no exprese.
4. Revisa claves foráneas, unicidad, defaults, zona horaria, enums, índices y rollback lógico. No edites migraciones ya aplicadas para simular una nueva.
5. Valida por generación/diff estático y pruebas enfocadas. No ejecutes `db:migrate`, `db:reset`, SQL contra producción ni borres volúmenes sin autorización explícita.
6. Si el cambio altera contratos o consultas, ejecuta typecheck y pruebas de los consumidores.

Entrega el orden de despliegue, artefactos sincronizados, validaciones y riesgos de datos pendientes.
