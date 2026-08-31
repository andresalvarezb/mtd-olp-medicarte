# ADR-020 — Lugar de dispensación como dato logístico versionado

**Estado:** ACCEPTED

## Contexto

Cuando una autorización queda lista para dispensar, Medicarte define mediante carga masiva el lugar o dirección a la cual OLP debe enviar el medicamento para su posterior aplicación.

## Decisión

Introducir una etapa logística explícita y persistida.

1. `READY_TO_DISPENSE` genera notificación a OLP y Medicarte.
2. Medicarte descarga la base completa permitida y carga únicamente llave + `lugar_dispensacion`.
3. El valor vigente se guarda en `authorization_items` y cada cambio queda en historial append-only.
4. El evento `DISPENSATION_LOCATION_ASSIGNED` o `DISPENSATION_LOCATION_CHANGED` se registra mediante outbox en la misma transacción.
5. El worker notifica a OLP con la dirección.
6. OLP descarga la base completa incluyendo `lugar_dispensacion` y continúa con el envío.

## Modelo

Estado derivado de lectura:

```text
application_site_status = lugar_dispensacion IS NULL
    ? PENDING_ASSIGNMENT
    : ASSIGNED
```

`application_site_status` no se persiste porque no aporta información independiente. La dirección no forma parte de `operation_status` porque representa logística.

## Consecuencias

- Se aplica ADR-022 y su historial de cambios.
- Medicarte obtiene permiso `bulk_updates.dispensation_location`.
- OLP puede leer la dirección dentro de su alcance.
- Modificar el lugar genera una nueva versión, auditoría y nueva notificación a OLP.
- Las notificaciones deben ser idempotentes por versión del campo.
