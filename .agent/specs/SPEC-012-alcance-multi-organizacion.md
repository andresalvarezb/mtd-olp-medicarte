# SPEC-012 — Alcance multi-organización de autorizaciones
**Fase:** 2

## Objetivo

Permitir que una autorización sea un registro único y compartido sin perder el aislamiento de permisos y organizaciones.

## Reglas

- `authorization_items` tiene una única fila global por `NUMERO_AUTORIZACION + COD_COMERCIAL`.
- MTD puede leer globalmente cuando el usuario tiene `authorizations.read`.
- Compensar, OLP y Medicarte solo leen ítems relacionados con la organización seleccionada y con permiso vigente.
- La relación se persiste en `authorization_item_organizations`.
- Las acciones de negocio específicas de OLP y Medicarte no forman parte de Fase 2.
- El backend aplica el permiso y el alcance; la UI no constituye una barrera de seguridad.

## Aceptación

- Confirmar una fila no crea copias por organización.
- Un usuario con `authorizations.read` puede consultar un ítem solo dentro de su alcance.
- Un usuario sin relación o permiso recibe denegación.
- MTD conserva lectura global sin duplicar registros.
