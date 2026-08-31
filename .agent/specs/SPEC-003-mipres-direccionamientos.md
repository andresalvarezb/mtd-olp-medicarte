# SPEC-003 — Validación de direccionamientos MIPRES

**Fase:** 3

**Estado externo:** DESBLOQUEADA por DEC-013. Contrato técnico aceptado en `../contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`.

## Precondición

Solo consultar cuando:

```text
coverage_type = NO_PBS
AND
enablement_status = HABILITADO
```

Los registros que no cumplan ambas condiciones no generan consulta al proveedor. PBS usa `direction_status = NO_APLICA`.

## Arquitectura

`Domain -> MipresPort -> MipresHttpAdapter`. Tests: `MipresFakeAdapter` y fixtures de contrato.

Contrato conceptual del puerto:

```text
MipresPort
    getDirectionsByPrescription(prescriptionNumber) -> Direction[]
```

El adaptador implementa:

```text
MipresHttpAdapter
    ├── MipresTokenProvider
    │     └── GET GenerarToken
    └── GET DireccionamientoXPrescripcion
```

## Servicio y endpoints

- Servicio: `WSSUMMIPRESNOPBS`.
- Base URL configurable mediante `MIPRES_BASE_URL`; nunca hardcodeada.
- `GET /api/GenerarToken/{nit}/{token}` con `MIPRES_NIT` y `MIPRES_INITIAL_TOKEN`; sin body.
- `GET /api/DireccionamientoXPrescripcion/{nit}/{token}/{noPrescripcion}`; sin body; sin paginación.
- El token operativo se obtiene en backend, se renueva cuando deje de ser válido, no se expone al frontend ni se registra completo en logs.

## Fuente del número de prescripción

`noPrescripcion` proviene de la columna `No.PRESCRIPCION` del archivo de importación (DEC-016): el valor original se conserva como evidencia y `no_prescripcion` se deriva retirando los últimos 3 dígitos de la derecha. El valor derivado alimenta `MipresPort`.

## Normalización

Cada direccionamiento se normaliza, como mínimo, a:

```text
MipresDirection {
    externalId
    directionId
    prescriptionNumber
    technologyType
    technologyConsecutive
    maximumDeliveryDate
    externalStatus
    annulled
    current
}
```

Campos oficiales requeridos: `ID`, `IDDireccionamiento`, `NoPrescripcion`, `TipoTec`, `ConTec`, `FecMaxEnt`, `EstDireccionamiento`, `FecAnulacion`. Los nombres oficiales del proveedor no salen del adaptador. El resto del payload se conserva como evidencia técnica, sin regla de vigencia.

## Resultados internos

- `PENDING`: no existen direccionamientos, o existen pero ninguno vigente.
- `CONFIRMADO`: existe al menos un direccionamiento no anulado con `current_date(America/Bogota) < fecha_maxima`.
- `ERROR_DE_CONSULTA`: fallo técnico (timeout, red, token inválido no recuperable, respuesta no interpretable, 5xx).
- `NO_APLICA`: PBS.

Un error técnico nunca se interpreta como ausencia de direccionamiento.

## Regla de vigencia

`FecMaxEnt` es la fecha oficial. Comparación estricta en `America/Bogota`:

- hoy < `fecha_maxima` => vigente;
- hoy = `fecha_maxima` => no vigente;
- hoy > `fecha_maxima` => no vigente;
- direccionamiento anulado => nunca vigente.

## Persistencia

Cada intento crea `mipres_check` con, como mínimo:

```text
prescription_number
queried_at
outcome
http_status
response_payload / referencia al raw
correlation_id
```

No sobrescribir respuestas históricas. Separar estado técnico de integración de datos oficiales MIPRES. Los tokens se eliminan o redactan antes de persistir cualquier request o respuesta técnica.

## Resiliencia

Timeout, retry solo recuperable, exponential backoff+jitter, circuit breaker, concurrencia configurable, rate limit manual, correlation ID. La renovación de token no expone secretos.

## Aceptación

Casos: timeout, 401/403, 500, respuesta inválida, sin direccionamientos (`PENDIENTE`), direccionamiento anulado (`PENDIENTE`), vigente (`CONFIRMADO`), igualdad con `FecMaxEnt` (`PENDIENTE`), reintento duplicado sin checks duplicados, evidencia histórica sin tokens, dominio sin nombres del proveedor.
