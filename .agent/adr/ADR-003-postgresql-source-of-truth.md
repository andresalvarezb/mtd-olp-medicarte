# ADR-003 — PostgreSQL como fuente de verdad
**Estado:** ACCEPTED

## Decisión
PostgreSQL conserva el estado autoritativo del negocio, relaciones, historial operacional y referencias externas.

Redis no es autoritativo. Google Drive no es autoritativo para estados. Las respuestas externas relevantes se registran de forma controlada en PostgreSQL.
