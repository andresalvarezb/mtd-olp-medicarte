# ADR-025 — Estados del backend en espanol

**Estado:** ACEPTADO

## Contexto

El backend exponia y persistia estados de negocio en ingles mientras la
interfaz los traducía para mostrarlos. Esto hacia que el contrato de la API,
las consultas operativas y la evidencia de PostgreSQL usaran vocabularios
distintos.

## Decision

Los estados de negocio y de procesamiento se expresan en espanol mediante
identificadores ASCII en mayusculas y con guion bajo. El catalogo normativo y
las equivalencias se mantienen en
[`docs/architecture/estados-backend.md`](../../docs/architecture/estados-backend.md).

La decision cubre:

- dimensiones de `authorization_items`;
- estados de lotes de importacion y actualizacion masiva;
- estado de notificaciones, auditoria, solicitudes de acceso y outbox;
- resultado de consultas MIPRES y resultados de jobs que representan estados;
- estados devueltos directamente por operaciones administrativas.

No se traducen codigos de error, codigos de resultado por fila, nombres de
eventos, nombres de colas, tipos de operacion ni nombres de columnas. Son
identificadores tecnicos usados para integracion, trazabilidad o versionado.

## Persistencia

La migracion `0018_estados_espanol` convierte datos existentes antes de
recrear las restricciones `CHECK`. Las migraciones `0018` y posteriores tambien
actualizan respuestas cacheadas de idempotencia, jobs y clasificaciones JSON de
filas para que una repeticion o consulta no reintroduzca valores en ingles.
Las migraciones historicas permanecen inmutables.

## Consecuencias

- API, worker, dominio y frontend comparten el mismo catalogo en espanol.
- Los filtros con valores anteriores en ingles dejan de ser validos.
- El cambio es de contrato y requiere desplegar la migracion antes de usar las
  versiones nuevas de API y worker.
- La evidencia historica append-only conserva los identificadores tecnicos de
  eventos y codigos; los estados de columnas se convierten de forma explicita.
