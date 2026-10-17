# Flujo de trabajo — OLP

**Rama/corte:** `develop` @ `7ced5792` · 2026-10-17. **Rol de negocio:** proveedor logístico/comercial OLP, no el creador de la demanda ni quien certifica el recibido físico en MEDICARTE.

## OLP-OC-01 — Consultar y evaluar órdenes emitidas

**Entrada:** una OC creada/emitida por MTD. **Pantalla:** `/ordenes-compra` (la ruta histórica `/logistica-olp` redirige a ella). **Permiso de lectura:** `purchase_orders.read`. La API del proveedor ofrece `GET /api/v1/supplier/purchase-orders` y `GET /api/v1/supplier/purchase-orders/:id`.

1. Abrir las OC visibles para la organización OLP y revisar código de OC, estado, producto, cantidad solicitada, punto y fechas.
2. Diferenciar cantidad **solicitada por MTD** de cantidad **administrada/comprometida por OLP**. No convertir automáticamente el solicitado en existencia ni en cantidad recibida.
3. Revisar costos OLP cuando la pantalla/flujo de revisión de líneas lo permita. El **costo unitario del proveedor** no es la tarifa contractual del AT pagada por COMPENSAR a MTD.
4. Si hay inconsistencias, utilizar devolución/revisión; no alterar información fuente de la AUTO.

## OLP-OC-02 — Aceptar y comprometer entrega

**Permiso:** `purchase_orders.review_supplier`; además, el servicio exige `organizationCode = OLP`. **API:** `POST /api/v1/supplier/purchase-orders/:id/accept`.

**Contrato representativo** (IDs y fechas sintéticos; ejemplo de forma, no operación real):

```json
{
  "expectedVersion": 1,
  "committedDate": "2026-10-21",
  "lines": [
    { "purchaseOrderLineId": "00000000-0000-4000-8000-000000000001", "managedQuantity": 4 }
  ],
  "observation": "Compromiso sujeto a verificación de inventario"
}
```

`expectedVersion` positivo evita actualizar una versión obsoleta. `committedDate` requiere `YYYY-MM-DD`; `lines` contiene una o más líneas con UUID y `managedQuantity` entero positivo. Una OC/organización no autorizada devuelve error, no aprobación tácita.

**Salida:** compromiso OLP, fecha y cantidad gestionada asociadas a la OC, con registro auditable. Una aceptación parcial no significa que MEDICARTE recibió parcialmente: son eventos distintos.

## OLP-OC-03 — Revisión, devolución y resultados parciales

Existen rutas adicionales de proveedor:

| Operación | Endpoint | Precondición conceptual |
| --- | --- | --- |
| Revisar línea | `POST /api/v1/supplier/purchase-orders/:id/lines/:lineId/review` | `expectedVersion`, `acceptedQuantity` entero ≥ 0; `supplierUnitCost` opcional |
| Devolver OC a MTD | `POST /api/v1/supplier/purchase-orders/:id/return` | `expectedVersion`, observación de 3–2000 caracteres |
| Completar revisión | `POST /api/v1/supplier/purchase-orders/:id/complete-review` | `expectedVersion` |

La máquina de estados soporta `ISSUED`, `UNDER_OLP_REVIEW`, `ACCEPTED`, `PARTIALLY_ACCEPTED`, `REJECTED`, etapas de despacho y recepción. **No extrapolar** que cada ruta pueda llamarse desde cualquier estado: confirmar transiciones vigentes y guards por API.

## OLP-LOG-01 — Entrega y seguimiento logístico

El repositorio incluye rutas separadas de `deliveries` y de recepción legacy, además de la recepción directa de OC que hoy usa MEDICARTE. **No mezclar ambos circuitos para una misma OC**: el repositorio de recepción directa bloquea si ya existen entregas del flujo legacy para la OC.

**Operación esperada:** después del compromiso, OLP informa/gestiona el envío; la **confirmación de recepción física** corresponde a MEDICARTE. El hecho de marcar despacho o compromiso no suma stock consumible. Validar cantidades, punto, fecha y posibles devoluciones/escasez con el detalle operacional antes de dar por cerrado el pedido.

## Matriz de excepciones

| Caso | Conducta documentada |
| --- | --- |
| OC no visible o de otra organización | No usar rutas ajenas; revisar visibilidad y permisos |
| Cambió la versión entre consulta y confirmación | Tratar `VERSION_CONFLICT` como actualización concurrente; recargar y volver a evaluar |
| OLP puede comprometer menos de lo solicitado | Registrar la gestión permitida por el contrato y comunicar la diferencia; no declarar recepción |
| No hay disponibilidad en OLP | No inventar fecha ni cantidad; evaluar devolución/revisión conforme al flujo habilitado |
| OC aceptada y MEDICARTE recibe menos | Recepción parcial gestionada por MEDICARTE; OLP debe revisar pendiente, sin reescribir histórico |
| Cambio de tarifa AT | No atribuir al AT el costo propio OLP; preservar costo/compromisos de OC según snapshots y reglas |

**Fuentes:** `apps/api/src/purchase-orders/purchase-order.controller.ts`, `purchase-order.service.ts`; `packages/contracts/src/index.ts`; `apps/web/features/purchase-orders/supplier-purchase-orders-view.tsx`.
