# ADR-020 — Punto de aplicación como etapa logística explícita
**Estado:** ACCEPTED

## Contexto
Cuando una autorización queda lista para dispensar, OLP necesita saber que debe iniciar coordinación y Medicarte necesita definir dónde realizará la aplicación. OLP solo puede despachar correctamente después de conocer ese punto/dirección.

## Decisión
Introducir una etapa logística explícita y persistida.

1. `READY_TO_DISPENSE` genera notificación a OLP y Medicarte.
2. Medicarte define el punto/dirección de aplicación.
3. La dirección se guarda como dato de negocio versionado y auditado.
4. El evento `APPLICATION_SITE_ASSIGNED` se registra mediante outbox.
5. El worker notifica a OLP con la dirección.
6. El flujo continúa posteriormente con aplicación, soportes y auditoría.

## Modelo
Nueva dimensión:

```text
application_site_status:
PENDING_ASSIGNMENT -> ASSIGNED
```

La dirección no forma parte de `operation_status` porque representa logística, no el estado clínico-operativo de la dispensación.

## Consecuencias
- Debe existir persistencia específica para la asignación.
- Medicarte obtiene permiso `application_site.assign`.
- OLP puede leer la dirección dentro de su alcance.
- Modificar la dirección genera una nueva versión, auditoría y nueva notificación a OLP.
- Las notificaciones deben ser idempotentes por versión de asignación.
