# SPEC-010 — API, observabilidad y seguridad transversal
**Fase:** 1 y transversal

## API
- `/api/v1`;
- OpenAPI;
- cursor pagination para listados grandes;
- ISO 8601 UTC;
- correlation ID;
- error `{code,message,fields?,correlationId}`;
- optimistic concurrency para actualizaciones sensibles;
- `Idempotency-Key` en mutaciones críticas.

## Límites operativos iniciales
- Tamaño máximo de archivo cargado: 20 MB.
- Volumen esperado: hasta 2.500 archivos por mes.

## Despliegue
- Objetivo primario esperado: Render.
- Alternativa permitida: Google Cloud.
- Docker debe mantener portabilidad entre proveedores.
- Región requerida: Colombia.
- Si el proveedor/servicio elegido no ofrece presencia física compatible en Colombia, producción queda bloqueada hasta una decisión explícita.

## Seguridad
TLS, secretos fuera del repo, mínimo privilegio, datos de prueba anonimizados, rate limit, sin secretos en logs, auditoría de descargas sensibles.

## Observabilidad
Health API/DB/Redis, métricas de cola, latencia/error MIPRES, Gmail/Drive failures, jobs agotados, logs JSON, trazas/correlation.

## Aceptación
Errores externos son diagnosticables sin exponer secretos y los fallos recuperables aparecen en una bandeja operativa.
