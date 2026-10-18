# Mapa de relaciones operativas principales

Este esquema es **orientativo** y muestra solo las relaciones verificadas en `packages/database/src/schema.ts` al commit `abdf411`. Los diagramas completos por dominio se generan con `node scripts/db-schema-catalog.mjs --generate`.

Las cardinalidades se presentan como lectura conceptual de FK, no como certificación de unicidad o cantidad mínima de registros. Algunos vínculos pueden ser opcionales y otros se derivan por lógica de negocio, sin una FK directa.

## 1. Identidad y permisos

```mermaid
erDiagram
    users ||--o{ user_organization_roles : user_id
    organizations ||--o{ user_organization_roles : organization_id
    roles ||--o{ user_organization_roles : role_id
    roles ||--o{ role_permissions : role_id
    permissions ||--o{ role_permissions : permission_id
    roles ||--o{ role_organization_scopes : role_id
    organizations ||--o{ role_organization_scopes : organization_id
```

**Lectura:** los permisos efectivos dependen de usuario, organización, rol y controles de ámbito de punto. Consultar `apps/api/src/identity/access.service.ts` y `packages/domain/src/organization-role-policy.ts`; una asignación SQL aislada no demuestra autorización operativa.

## 2. Autorización → OC → recepción → asignación → consumo

```mermaid
erDiagram
    authorization_items ||--o{ purchase_order_authorization_sources : authorization_item_id
    purchase_order_lines ||--o{ purchase_order_authorization_sources : purchase_order_line_id
    purchase_orders ||--o{ purchase_order_lines : purchase_order_id
    purchase_orders ||--o{ purchase_order_receipts : purchase_order_id
    purchase_order_receipts ||--o{ purchase_order_receipt_lines : receipt_id
    purchase_order_lines ||--o{ purchase_order_receipt_lines : purchase_order_line_id
    authorization_items ||--o{ inventory_authorization_allocations : authorization_item_id
    purchase_orders ||--o{ inventory_authorization_allocations : purchase_order_id
    authorization_items ||--o{ authorization_fulfillments : authorization_item_id
    authorization_fulfillments ||--o{ authorization_fulfillment_lines : fulfillment_id
    inventory_authorization_allocations ||--o{ authorization_fulfillment_lines : inventory_authorization_allocation_id
```

**Punto de control:** `purchase_order_authorization_sources` documenta el vínculo de compra; `purchase_order_receipt_lines` documenta cantidad efectivamente recibida por OC; `inventory_authorization_allocations` documenta reservas; `authorization_fulfillment_lines` documenta consumo/aplicación. No unir todo únicamente por código comercial ni sumar sin delimitar OC, punto y estado.

**Dos modelos de recepción coexisten:** `purchase_order_receipts`/`purchase_order_receipt_lines` (recepción directa de OC con cantidad) y `receipts`/`receipt_lines` (recepción asociada a entregas/lotes). No consolidarlos sin verificar el servicio correspondiente.

## 3. Programación, atención y novedades

```mermaid
erDiagram
    authorization_items ||--o{ patient_schedules : authorization_item_id
    planning_periods ||--o{ patient_schedules : planning_period_id
    dispensing_points ||--o{ patient_schedules : dispensing_point_id
    patient_schedules ||--o{ patient_schedule_history : patient_schedule_id
    patient_schedules ||--o{ patient_schedule_outcomes : patient_schedule_id
    patient_schedule_outcomes ||--o{ patient_schedule_outcome_lines : outcome_id
    inventory_lots ||--o{ patient_schedule_outcome_lines : inventory_lot_id
    patient_schedules ||--o{ patient_applications : patient_schedule_id
    patient_applications ||--o{ patient_application_lines : patient_application_id
    inventory_lots ||--o{ patient_application_lines : inventory_lot_id
```

**Lectura:** `patient_schedule_outcomes` incluye resultados de no aplicación; `patient_schedule_outcome_lines` registra unidades de productos no reutilizables vinculadas a un lote. La programación no equivale a movimiento físico.

## 4. Stock físico y traslados

```mermaid
erDiagram
    dispensing_points ||--o{ inventory_lots : dispensing_point_id
    inventory_locations ||--o{ inventory_lots : inventory_location_id
    inventory_lots ||--o{ inventory_movements : inventory_lot_id
    dispensing_points ||--o{ stock_transfers : source_dispensing_point_id
    stock_transfers ||--o{ stock_transfer_lines : stock_transfer_id
    inventory_lots ||--o{ stock_transfer_lines : source_inventory_lot_id
```

`stock_transfers` también referencia el punto de destino. El stock confiable se deriva del libro de movimientos y de las restricciones operacionales; no debe suponerse que una OC aceptada ya está disponible.

## Regla de lectura para futuras auditorías

**Toda investigación debe registrar:** tabla y columnas, FK o vínculo lógico, proceso que crea/modifica, estado/autorización, cantidades y unidad, ambiente, SHA de código, prueba que verifica la regla y cualquier diferencia entre Drizzle y PostgreSQL real.
