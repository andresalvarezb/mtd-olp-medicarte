# SPEC-003 — Validación de direccionamientos MIPRES
**Fase:** 3

## Precondición
Solo consultar cuando `coverage_type = NO_PBS` y `enablement_status = ENABLED`.

## Arquitectura
`Domain -> MipresPort -> MipresHttpAdapter`.
Tests: `MipresFakeAdapter` y fixtures de contrato.

## Resultados internos
- `PENDING`: no existe un direccionamiento que cumpla la regla de vigencia.
- `CONFIRMED`: existe al menos un direccionamiento cuya `fecha_maxima` cumple `current_date(America/Bogota) < fecha_maxima`.
- `QUERY_ERROR`: no pudo determinarse el resultado por fallo técnico.
- `NOT_APPLICABLE`: PBS.

## Persistencia
Cada intento crea `mipres_check`. No sobrescribir respuestas históricas. Separar estado técnico de integración de datos oficiales MIPRES.

## Resiliencia
Timeout, retry recuperable, exponential backoff+jitter, circuit breaker, concurrencia configurable, rate limit manual, correlation ID.

## Aceptación
Casos: timeout, 401, 500, respuesta inválida, sin direccionamiento, válido, reintento duplicado.

## Regla de vigencia confirmada
La comparación es estricta:
- hoy < `fecha_maxima` => válido;
- hoy = `fecha_maxima` => no válido;
- hoy > `fecha_maxima` => no válido.

Una respuesta técnicamente inválida o que no permita evaluar `fecha_maxima` no debe presentarse como “sin direccionamiento”; debe conservar la separación con `QUERY_ERROR`.
