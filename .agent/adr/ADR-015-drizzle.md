# ADR-015 — Drizzle como capa de persistencia tipada

**Estado:** ACCEPTED según stack del documento

## Decisión

Usar Drizzle para esquema/migraciones/acceso tipado a PostgreSQL. SQL explícito puede utilizarse cuando una consulta lo justifique.

## Nota de consistencia

La estructura del monorepo original decía “Prisma y migraciones”; se corrige a “Drizzle y migraciones”.
