# ADR-001 — Aplicación web responsive

**Estado:** ACCEPTED

## Contexto

Varias organizaciones trabajan sobre el mismo proceso con tablas, filtros, archivos, permisos y auditoría.

## Decisión

Construir una aplicación web responsive. No incluir aplicación móvil nativa en el MVP.

## Consecuencias

Un único canal principal de interfaz. Cualquier PWA/app nativa futura deberá consumir los mismos contratos backend y no duplicar reglas de negocio.
