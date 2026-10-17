# Devoluciones, producto dañado y merma: límite de implementación

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

## No mezclar cuatro eventos

| Evento | Qué sí está evidenciado en código | Qué NO debe suponerse |
| --- | --- | --- |
| Rechazo durante recepción legacy | `rejectedQuantity`, `nonconformityReason`, `DAMAGED_PRODUCT`, `PACKAGING_ISSUE`, lote/vencimiento | Que se creó una orden de devolución al proveedor |
| No aplicación con producto preparado no reutilizable | Movimiento `inventory_movements` con `movement_type='NON_REUSABLE'` y cantidad negativa, ligado a una línea de resultado | Que el hecho equivale a baja contable, destrucción sanitaria o devolución física |
| Traslado despachado con avería en tránsito | Estados y movimientos de salida/entrada por traslado | Que existe recepción parcial o reverso de traslado expuesto |
| Producto vencido almacenado | Validación de vencimiento en uso/traslado; vencimiento de AUTO no libera inventario | Que exista ajuste físico automático de stock por vencimiento |

| ID | Caso | Tratamiento documental | Estado |
| --- | --- | --- | --- |
| CE-64 | Recibir unidades dañadas | Rechazar unidades en recepción y documentar no conformidad y evidencia | IMPLEMENTADO EN FUENTE |
| CE-65 | Pérdida por preparación no reutilizable | Registrar `NOT_APPLIED` + `NON_REUSABLE` + lotes/cantidades; auditar salida | IMPLEMENTADO EN FUENTE |
| CE-66 | Devolver al proveedor unidades **ya confirmadas** | Requiere especificación de RMA, reverso de existencia, estado, aprobación y contabilidad | REQUIERE DECISIÓN / SIN FLUJO VERIFICADO |
| CE-67 | Transferir sobrante desde un punto a otro | Usar módulo de traslados con registro de movimiento; no confundirlo con devolución | IMPLEMENTADO EN FUENTE |
| CE-68 | Producto caducado, roto o perdido fuera del flujo de atención | Definir ajuste de inventario con motivo, segregación, responsable y autorización | REQUIERE DECISIÓN / SIN FLUJO VERIFICADO |
| CE-69 | Reparación retroactiva de consumos, recepciones o bajas | Evitar SQL ad hoc; requerir movimiento compensatorio con auditoría e idempotencia | REQUIERE DECISIÓN |

## Requisitos propuestos para un módulo futuro (NO implementados)

- Identificador único de caso, origen (OC/recepción/traslado/lote), proveedor, motivo, evidencia y usuario solicitante.
- Flujo `SOLICITADO → APROBADO/RECHAZADO → DESPACHADO → CONFIRMADO` **solo como propuesta**; no corresponde a contratos actuales.
- Ajuste de inventario por movimiento compensatorio, separación de lote y vencimiento, prevención de saldo negativo, trazabilidad física y evento de auditoría.
- Tratamiento financiero separado: nota crédito, costo a asumir, devolución de dinero y conciliación contractual según decisión aprobada.

**Fuentes revisadas:** `receipt.repository.ts`, `stock-transfer.repository.ts`, `patient-outcome.repository.ts`, `inventory.controller.ts`, contratos de receipt/stock transfer y migraciones de inventario. **Límite:** ausencia de controlador identificado no es prueba absoluta de inexistencia de integración externa; validar con responsables antes de planificar desarrollo.
