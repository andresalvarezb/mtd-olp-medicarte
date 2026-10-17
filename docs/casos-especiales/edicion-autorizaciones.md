# CE-01 a CE-07 — Editar vigencia, producto y cantidad de una autorización

**Verificado en fuente:** `AuthorizationManualEditController`, `AuthorizationManualEditService`, `decideAuthorization16Renewal`, [BR-AUTO-REN-001](../requirements/BR-AUTO-REN-001-estado-16-vigencia.md). **Endpoint:** `PATCH /api/v1/authorizations/:id/manual-edit`. **Permiso:** `authorizations.manual_edit`; **organización efectiva:** MTD. Las fechas en esta ruta son `YYYY-MM-DD` calendario real (no 2026-02-30).

## Contrato y preparación

La edición manual **envía siempre todos** los campos, aunque el usuario solo cambie vigencia:

```json
{
  "commercialCode": "CODIGO-COMERCIAL-VIGENTE",
  "quantity": 12,
  "validityEndDate": "2026-11-30",
  "expectedVersion": 3
}
```

`commercialCode` identifica el producto; `quantity` es entero positivo; `expectedVersion` se obtiene de la lectura más reciente y debe coincidir. El JSON es ilustrativo, no un dato clínico. Se exige token Bearer y encabezado `X-Organization-Id` de la organización autorizada. Al editar una AUTO, la clave `numero_autorizacion|codigo_comercial` puede cambiar.

## CE-01 — Extender vigencia sin cambiar producto ni cantidad

**Precondiciones:** AUTO no anulada; versión actual; fecha válida; el nuevo fin de vigencia no puede preceder una entrega o aplicación registrada.

**Secuencia:** consultar detalle y versión → mantener producto/cantidad → ingresar nueva fecha → aplicar PATCH → revisar respuesta `impact.validityChanged` y nueva `version` → verificar historia/auditoría y vista de consulta. La modificación de fecha por sí misma no crea stock, no cambia el costo OLP y no equivale a conformidad de atención.

### CE-02 — Transición excepcional del estado fuente 16 a 5

Si la AUTO existente tiene estado efectivo **16**, la fecha anterior y nueva son válidas, la fecha se **amplía estrictamente** y la nueva vigencia es igual o posterior al día actual en **America/Bogota**, `decideAuthorization16Renewal` puede promover el estado efectivo a **5**. Se conserva evidencia en `source_data.__authorizationRenewal16To5`, se incrementa versión y se registra `AUTHORIZATION_MANUAL_EDITED`.

**Alcance estricto:** la promoción elimina solo ese bloqueo de estado fuente; AT, PBS/NO PBS, cantidad mínima, MIPRES, vigencia, elegibilidad para compra y reglas de atención siguen siendo controles independientes. En una recarga posterior XLSX que vuelva a traer estado 16 existe protección contra retroceso (`AUTHORIZATION_RENEWAL_STALE_RELOAD`). Una edición conjunta con cambio de producto/cantidad sigue la ruta general y sus validaciones; no puede presentarse como la vía excepcional de vigencia exclusivamente.

## CE-03 — Cambiar código comercial del producto

1. MTD selecciona otro **código comercial** y conserva los demás campos requeridos.
2. El backend normaliza código y exige **producto activo** en AT; comprueba cantidad mínima y que no exista otro ítem de la misma autorización con ese código (`AUTHORIZATION_IDENTITY_CONFLICT`).
3. Si hubo `authorization_fulfillments`, aplicación confirmada o consumo de inventario, el cambio **se bloquea** (`AUTHORIZATION_PRODUCT_ALREADY_FULFILLED`).
4. Si hay aplicación en borrador (`patient_applications` `DRAFT`), se bloquea cambio de producto o cantidad (`AUTHORIZATION_DRAFT_APPLICATION_EXISTS`).
5. Programaciones activas `SCHEDULED`/`RESCHEDULED`, cuando existen y se permite la modificación, se actualizan y generan nueva revisión `patient_schedule_history` con `UPDATED` (sin borrar historia).
6. Se libera el saldo **no consumido** de asignaciones (`released_quantity`, estado `RELEASED`). No es un nuevo ingreso de inventario físico.
7. Solo se concilia una relación OC todavía bajo control exclusivo MTD (`DRAFT`/`ISSUED`, sin aceptación OLP, sin despacho, sin recepción) y cuando la relación es simple. De otro modo, se conserva el registro histórico de OC y se reporta `activePurchaseOrderEffect: HISTORICAL_PRESERVED`.

**Punto de control:** al cambiar de producto no se debe asignar automáticamente inventario del nuevo código ni reescribir una compra/recepción previa. La diferencia `code -> producto -> cantidad/presentación` se revisa contra el catálogo, no se asume equivalencia.

## CE-04 — Aumentar cantidad autorizada

**Validaciones:** entero positivo; AT activa; mínimo; ausencia de aplicación borrador; restricciones de programación; versión. La ruta no crea unidades de inventario, no incrementa una reserva de forma ficticia. Si la AUTO tiene OC ya intervenida por OLP se preserva el histórico. Si una OC MTD aún puede mutarse, el importador intenta reconciliar su única relación elegible.

## CE-05 — Reducir cantidad autorizada

No se permite bajar de la cantidad ya entregada/aplicada (`AUTHORIZATION_QUANTITY_BELOW_FULFILLED`). La reserva activa se reduce **solo si excede** la nueva capacidad restante: `targetActive = max(nuevaCantidad - consumo, 0)`, sin hacer negativa ninguna asignación. Los saldos no liberados permanecen trazados a sus asignaciones. **No se presupone que el producto queda libre para cualquier OC**: disponibilidad y punto se evalúan por sus respectivos modelos.

## CE-06 — Cambios con OC y programación existentes

| Condición | Política observada |
| --- | --- |
| OLP aceptó OC, hubo despacho/entrega o recepción Medicarte | Conservar OC histórica; no reescribirla como si aún fuera borrador |
| Una sola relación OC exclusivamente MTD, estado `DRAFT`/`ISSUED` y sin downstream | Servicio puede reconciliar producto/cantidad y versionar OC |
| Más de una relación de OC MTD mutable para el cambio | Rechazar `AUTHORIZATION_PO_RECONCILIATION_COMPLEX` |
| Más de una programación activa y se cambia cantidad | Rechazar `AUTHORIZATION_SCHEDULE_RECONCILIATION_COMPLEX` |
| Existe aplicación `DRAFT` y cambia producto/cantidad | Rechazar `AUTHORIZATION_DRAFT_APPLICATION_EXISTS` |
| AUTO anulada | Rechazar `AUTHORIZATION_ALREADY_ANNULLED` |
| Versión cambió en otro proceso | Rechazar `AUTHORIZATION_VERSION_CONFLICT` |

## CE-07 — Fecha incompatible con atención confirmada

Rechazar `AUTHORIZATION_VALIDITY_BEFORE_FULFILLMENT` si la nueva fecha termina antes del último cumplimiento/aplicación registrada. La nueva fecha **no** reescribe la fecha de atención histórica.

## Evidencias de aceptación

- Respuesta de actualización con `id`, clave, nueva versión, cambios de producto/cantidad/vigencia, `releasedInventoryQuantity`, `historicalPurchaseOrderIds`, `activePurchaseOrderEffect`, `olpAlreadyAccepted` y `medicarteAlreadyReceived`.
- Evento `AUTHORIZATION_MANUAL_EDITED`, `PATIENT_SCHEDULE_UPDATED` si corresponde; historial de programación y notificaciones outbox.
- Confirmación de invariantes en BD ante rollback y concurrencia; sin datos personales reales en ejemplos o logs compartidos.

**Archivos fuente:** `apps/api/src/clinical/authorization-manual-edit.controller.ts`, `apps/api/src/clinical/authorization-manual-edit.service.ts`, `packages/domain/src/authorization-source-renewal.ts`, `docs/requirements/BR-AUTO-REN-001-estado-16-vigencia.md`.
