# SPEC-011 — Punto de aplicación y coordinación logística
**Fases:** 4 y 5

## Objetivo
Permitir que Medicarte defina el lugar de aplicación de un medicamento y que OLP reciba esa información para coordinar el envío.

## Precondición
El ítem debe tener:

```text
operation_status = READY_TO_DISPENSE
```

## Estados
`application_site_status`:
- `PENDING_ASSIGNMENT`
- `ASSIGNED`

## Flujo

```text
READY_TO_DISPENSE
    -> crear evento AUTHORIZATION_READY_TO_DISPENSE
    -> notificar OLP
    -> notificar Medicarte
    -> Medicarte selecciona/define punto de aplicación
    -> persistir application_site
    -> application_site_status = ASSIGNED
    -> crear evento APPLICATION_SITE_ASSIGNED
    -> notificar OLP con la dirección
    -> continúa proceso de aplicación
```

## Datos mínimos del punto de aplicación
- `authorization_item_id`
- `address_line`
- ciudad/municipio
- departamento
- referencia o complemento opcional
- nombre del punto/sede opcional
- latitud/longitud opcionales si posteriormente se habilitan
- `version`
- actor
- organización
- `created_at`
- `updated_at`

No almacenar una dirección únicamente dentro del cuerpo de una notificación.

## Reglas
1. Solo Medicarte puede crear/modificar el punto de aplicación.
2. OLP y MTD pueden consultarlo según permisos.
3. La primera asignación produce `APPLICATION_SITE_ASSIGNED`.
4. Una modificación produce `APPLICATION_SITE_CHANGED`.
5. Cada cambio incrementa versión.
6. Cada versión debe conservar auditoría.
7. Cada nueva versión dispara una nueva notificación a OLP.
8. Un reintento del job no duplica el correo para la misma versión.
9. Una falla Gmail no revierte la dirección guardada.
10. No iniciar la aplicación/registro de dispensación si el punto de aplicación aún está `PENDING_ASSIGNMENT`.

## API sugerida
- `GET /authorization-items/:id/application-site`
- `PUT /authorization-items/:id/application-site`

`PUT` debe usar autorización, control de concurrencia e `Idempotency-Key`.

## Criterios de aceptación
- Al llegar a `READY_TO_DISPENSE`, OLP y Medicarte reciben la notificación lógica correspondiente.
- Medicarte asigna dirección y esta queda persistida/auditada.
- OLP recibe una segunda notificación con la dirección.
- Reprocesar cualquier evento no duplica mensajes.
- Cambiar la dirección genera una nueva versión y una nueva notificación.
- Ningún usuario fuera de Medicarte puede modificar la dirección.
