# Flujo de trabajo — MEDICARTE

**Rama/corte:** `develop` @ `7ced5792` · 2026-10-17. **Responsabilidades centrales:** programación operativa, recepción física de producto y entrega/aplicación al paciente; no emitir compras en nombre de MTD ni confirmar compromisos de OLP.

## MED-PROG-01 — Programación y punto de atención

La interfaz `/programacion` y el controlador `patient-schedules` permiten consultar, crear, reprogramar, cancelar y realizar importaciones de programación conforme a permisos. Capturar fecha, punto y autorización compatibles. La demanda derivada es **proyectada**: programar no reserva irrevocablemente una unidad para un paciente ni equivale a una entrega o aplicación.

**Entregable:** programa por punto/fecha; cuando corresponda, puede alimentar períodos de planeación y consolidación. La ruta de OC directa permite otros orígenes, por lo que no forzar una programación como precondición universal.

## MED-REC-01 — Confirmar recepción física de una OC aceptada

**Pantalla:** `/recepciones` y detalle operacional en `/ordenes-compra/[id]`. **Permiso:** `medicarte_receipts.manage` y organización MEDICARTE para la recepción directa. **API:** `POST /api/v1/medicarte/purchase-orders/:id/receipts`.

**Antes de recibir:** la OC debe existir y tener aceptación OLP (`olp_accepted_at`). No registrar recepción por esta ruta si la OC utiliza `deliveries` del flujo legacy. Verificar punto, medicamento, cantidad y soporte físico.

**Contrato representativo** (UUID sintético):

```json
{
  "receivedAt": "2026-10-21T15:00:00Z",
  "observation": "Recepción parcial verificada físicamente",
  "lines": [
    { "purchaseOrderLineId": "00000000-0000-4000-8000-000000000001", "receivedQuantity": 5 }
  ]
}
```

Cada `receivedQuantity` es un **entero positivo**. Una línea repetida dentro del mismo envío es inválida. El endpoint de ejemplo no acepta una línea con cantidad cero para declarar rechazo total; documentar y probar el mecanismo de reporte de no recepción por separado, sin registrar unidades ficticias.

**Resultado y controles:** se registra la recepción y sus líneas en `purchase_order_receipts` y `purchase_order_receipt_lines`. La implementación ejecuta conciliación automática de asignaciones de la OC al confirmar la recepción; la disponibilidad moderna `quantity-only` no requiere inventar lotes en el ledger legacy. Puede quedar un remanente pendiente. Es esencial revisar la cantidad recibida acumulada y la cantidad asignada de cada OC; **no asumir que cualquier AUTO está automáticamente disponible por recibir producto**.

**Ejemplo ilustrativo:** OC solicitada 10, recepción parcial 5 → el saldo físico no puede exceder 5 menos consumos/egresos válidos. Para el remanente 5, registrar otra recepción real cuando suceda, con guardas de duplicidad y límites.

**Flujo legacy separado:** `POST /api/v1/medicarte/receipts`, `PATCH /api/v1/medicarte/receipts/:id`, `POST /api/v1/medicarte/receipts/:id/confirm` opera a partir de una entrega. No usar esa ruta para simular la recepción directa.

## MED-ATEN-01 — Entregar o aplicar una autorización

**Pantalla:** `/autorizaciones/consulta`. **Permiso:** `patient_applications.manage`. **Actor:** servicio `AuthorizationFulfillmentService` exige `organizationCode=MEDICARTE`. **API:** `POST /api/v1/medicarte/authorizations/:id/fulfill`.

**Entrada del contrato:**

```json
{
  "purchaseOrderCode": "OC-200",
  "fulfillmentType": "APPLICATION",
  "effectiveDate": "2026-10-21",
  "quantity": 1
}
```

`fulfillmentType` admite `APPLICATION` o `DELIVERY`; `quantity` entero positivo. La fecha se expresa en `YYYY-MM-DD`. El ID de la ruta es el UUID del ítem de autorización, distinto de `NUMERO_AUTORIZACION`.

**Verificaciones previas:** autenticación/point scope; AUTO vigente, habilitada y no anulada; OC/producto compatibles; cantidad disponible por recepción real y reserva; saldo no consumido; no superar autorizada ni disponibilidad. Algunas condiciones generan `409`, por ejemplo `AUTHORIZATION_FULFILLMENT_INSUFFICIENT_OC_POOL`, `INSUFFICIENT_INVENTORY`, `OC_NOT_ELIGIBLE`, `ALREADY_CLOSED`, `PARTIAL_ASSIGNMENT`.

**Salida:** fulfillment confirmado, cantidades y referencias a OC. Los consumos confirmados no son reasignables; no es correcto registrar anulación si ya hubo entrega o aplicación.

## MED-FECHA-01 — Carga de fechas de dispensación

Existe un procedimiento **distinto** de la entrega/aplicación: `GET /api/v1/authorizations/dispensation/template` y `POST /api/v1/authorizations/dispensation/import`, con permiso `bulk_updates.dispensation_date`; el servicio exige organización MEDICARTE o la excepción de administrador fundacional. El archivo es XLSX (máximo 20 MiB). **No confundir registrar/actualizar fecha de dispensación con un fulfillment físico.**

## MED-EXC-01 — Manejo de excepciones

| Excepción | Acción válida |
| --- | --- |
| OC todavía no aceptada por OLP | Solicitar aceptación; no registrar recepción directa |
| Cantidad recibida menor que la gestionada | Confirmar únicamente lo físicamente recibido; dejar pendiente y comunicar diferencia |
| Producto equivocado o punto incompatible | Bloquear/gestionar novedad, no compensar con otra AUTO arbitraria |
| AUTO vencida | No entregar ni aplicar; revisar ventana de gracia y liberación según política |
| AUTO anulada o con consumo previo | No reabrirla por recarga; la anulación con consumo está prohibida |
| Se recibe producto para una AUTO que no asiste | No registrar aplicación ficticia; seguir flujo de disponibilidad/reasignación autorizado |
| Error de stock insuficiente | Revisar recepción, allocations y conciliación; no repetir fulfillment sin verificar estado |

**Fuentes:** `apps/api/src/receipts/receipt.controller.ts`, `receipt.repository.ts`, `fulfillments/*`, `dispensation-import/*`, `packages/contracts/src/index.ts`, `docs/adr/043-*`.
