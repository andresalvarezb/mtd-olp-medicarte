# SPEC-011 — Lugar de dispensación y coordinación logística

**Fases:** 4 y 5

## Objetivo

Permitir que MEDICARTE defina masivamente `lugar_dispensacion`, la dirección a la cual OLP envía el medicamento para su aplicación posterior, y notificar cada valor nuevo a OLP.

## Flujo

```text
LISTO_PARA_DISPENSAR
    -> notificar OLP + MEDICARTE
    -> MEDICARTE descarga base completa permitida
    -> carga llave + lugar_dispensacion
    -> persistir valor vigente + historial + auditoría
    -> DISPENSATION_LOCATION_ASSIGNED | DISPENSATION_LOCATION_CHANGED
    -> notificar OLP después del commit
    -> OLP descarga base completa con lugar_dispensacion
```

## Modelo y estado derivado

`lugar_dispensacion` es un campo de negocio en `authorization_items` y su contenido es **texto libre**, decidido por el negocio. No se impone una estructura de dirección más granular; el sistema solo valida valor no vacío y normaliza espacios. Cada cambio crea una entrada en `operational_field_changes` y aumenta la versión.

`application_site_status` deja de ser persistido y se deriva:

- valor nulo: `PENDIENTE_ASIGNACION`;
- valor presente: `ASIGNADO`.

## Reglas

1. Solo MEDICARTE puede ejecutar `ASSIGN_DISPENSATION_LOCATION` dentro de su alcance.
2. La carga usa exactamente `numero_autorizacion`, `codigo_medicamento`, `lugar_dispensacion`.
3. OLP y MTD pueden consultarlo según permisos.
4. Primera asignación produce `DISPENSATION_LOCATION_ASSIGNED`; modificación real produce `DISPENSATION_LOCATION_CHANGED`.
5. Cada cambio registra antes/después, actor, organización, lote, fila, versión y timestamp.
6. Cada nueva versión notifica a OLP; un reintento no duplica correo.
7. Gmail caído no revierte el valor persistido.
8. OLP no puede reportar `fecha_dispensacion` mientras el lugar sea nulo.

## API

No se ofrece formulario individual ni `PUT /authorization-items/:id/application-site`. Se usa el contrato genérico de SPEC-013. El detalle del ítem puede exponer el valor y el estado derivado en lectura.

## Aceptación

- La descarga de MEDICARTE contiene información completa permitida para preparar el archivo reducido.
- Columnas ajenas son rechazadas por backend.
- OLP recibe una notificación por cada versión real y ve el valor en su descarga.
- Ningún actor fuera de MEDICARTE modifica el lugar mediante este tipo de operación.
