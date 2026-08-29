# ADR-018 — Exportaciones bajo demanda sin persistencia

**Estado:** ACCEPTED

## Contexto

Los usuarios necesitan descargar consolidados en CSV o Excel, pero no se requiere conservar una copia de cada exportación.

## Decisión

- Generar CSV/XLSX cuando el usuario solicita exportar.
- No almacenar persistentemente el archivo generado.
- Permitir streaming, memoria o almacenamiento temporal efímero.
- Eliminar cualquier temporal al completar o fallar.
- Auditar actor, fecha, filtros, formato y resultado.

## Consecuencias

- No se requiere una biblioteca permanente de exportaciones.
- El flujo normal no depende de `export_jobs` que persistan archivos.
- Si en el futuro el volumen exige procesamiento diferido, deberá seguir siendo temporal y con eliminación automática.
