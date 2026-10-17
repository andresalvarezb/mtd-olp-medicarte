# Compensación, costos OLP y conciliación financiera

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

## Distinción de datos y procesos

- `compensarUnitRateSnapshot` es el **valor tarifario de referencia** de la línea de OC para la relación COMPENSAR→MTD, según Anexo Tarifario/snapshot.
- `supplierUnitCost` representa el **costo unitario proveedor** OLP→MTD en la OC; OLP puede definirlo en el proceso de revisión de líneas (`reviewPurchaseOrderLineRequestSchema`).
- Las analíticas distinguen valores solicitados/aceptados y referencias de margen operacional; **no equivalen por sí mismas a factura aceptada, pago o contabilización**.
- El rol `COMPENSAR_VIEWER` es de lectura restringida; la migración 0091 enumera lecturas y elimina permisos no autorizados.

| ID | Situación | Qué se puede afirmar | Estado |
| --- | --- | --- | --- |
| CE-70 | Tarifa COMPENSAR y costo OLP difieren | Se conservan campos separados por línea de OC; no reemplazar uno con otro | IMPLEMENTADO EN FUENTE |
| CE-71 | Cambio posterior del AT | Conservar snapshots históricos en OC; no recalcular acuerdos históricos sin regla explícita | IMPLEMENTADO EN FUENTE / VALIDAR CASOS |
| CE-72 | OLP acepta una parte y asigna precio | Aceptación parcial y costo unitario se reflejan en línea; análisis económico debe usar cantidades del estado real | IMPLEMENTADO EN FUENTE |
| CE-73 | MTD exporta indicadores económicos | `GET /api/v1/analytics/economics` requiere `analytics.economics.read`; en `export.xlsx` se incluyen datos económicos solo con permiso adicional | IMPLEMENTADO EN FUENTE |
| CE-74 | Auditoría de facturación marca NO CUMPLE | Es **decisión de auditoría operacional**, no evidencia automática de nota débito, glosa financiera, factura contabilizada o pago retenido | IMPLEMENTADO EN FUENTE (auditoría) / SIN FLUJO FINANCIERO VERIFICADO |
| CE-75 | Conciliar factura proveedor y factura pagador, notas y diferencias | No se identificó flujo completo de cuentas por cobrar/pagar, cartera, asiento, glosa/reversión/pago en módulos analizados | REQUIERE DECISIÓN / SIN FLUJO VERIFICADO |

## Matriz mínima propuesta para conciliación (NO implementada como proceso contable)

| Clave de control | Documento/evidencia | Cantidad y base de valor | Control de diferencia |
| --- | --- | --- | --- |
| OC + línea + producto + punto | OC, aceptación OLP y tarifa snapshot | Solicitada, aceptada, costo proveedor | Diferencia pedido/aceptación; cambio de costo |
| OC + recepción + línea | Acuse físico y novedades | Recibida, aceptada, rechazada | Faltante, no conformidad o diferencia de lote |
| AUTO + atención | Soporte de entrega/aplicación y auditoría | Realmente aplicada/entregada | No facturar solo unidades reservadas |
| Factura OLP + detalle | **Origen externo por integrar** | Costo unitario, impuestos, retenciones | Cruce contra OC y recepción |
| Factura/compensación COMPENSAR | **Origen externo por integrar** | Tarifa contractual, glosas, pagos | Cruce contra soporte y atención |

**Decisiones pendientes:** fuente oficial de factura, equivalencia documental, impuestos, periodos de corte, redondeo, precios por vigencia, conciliación de glosas, autorización de notas y tratamiento de devolución. No insertar estados financieros o asientos en la plataforma sin requerimiento aprobado.

**Código verificado:** `packages/contracts/src/index.ts` (OC costos); `apps/api/src/analytics/analytics.{controller,repository}.ts`; `apps/api/src/exportables/exportables.controller.ts`; `apps/api/src/audits/authorization-billing-audit*.ts`; `packages/database/migrations/0091_compensar_observer.sql`.
