# SPEC-010 — API, observabilidad y seguridad transversal

**Fase:** 1 y transversal

## API

- `/api/v1`;
- OpenAPI;
- cursor pagination para listados grandes;
- ISO 8601: timestamps UTC (`date-time`) y fechas calendario operativas como `date` (`YYYY-MM-DD`) sin zona horaria;
- correlation ID;
- error `{code,message,fields?,correlationId}`;
- optimistic concurrency para actualizaciones sensibles;
- `Idempotency-Key` en mutaciones críticas.
- replay idempotente sujeto a autorización, alcance y redacción vigentes.

## Límites operativos iniciales

- Tamaño máximo de archivo cargado: 20 MB.
- No se aplica un límite mensual de soportes: esos archivos no ingresan a la aplicación.

## Despliegue

- Objetivo primario esperado: Render.
- Alternativa permitida: Google Cloud.
- Docker debe mantener portabilidad entre proveedores.
- Región requerida: Colombia.
- Si el proveedor/servicio elegido no ofrece presencia física compatible en Colombia, producción queda bloqueada hasta una decisión explícita.

## Seguridad

TLS, secretos fuera del repo, mínimo privilegio, datos de prueba anonimizados, rate limit, sin secretos en logs, auditoría de descargas sensibles.

## Observabilidad

Health API/DB/Redis, métricas de cola, latencia/error MIPRES, fallos Gmail, jobs agotados, logs JSON y trazas/correlation. Drive no requiere health técnico porque no existe integración de archivos desde la aplicación.

## Aceptación

Errores externos son diagnosticables sin exponer secretos y los fallos recuperables aparecen en una bandeja operativa.
