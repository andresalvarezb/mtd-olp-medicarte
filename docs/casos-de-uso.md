# Catálogo de casos de uso operacionales

**Corte:** `develop` @ `7ced5792`. Los siguientes casos tienen rutas/código observables, pero sus resultados deben certificarse contra API/DB con identidades sintéticas. **Implementado** = entrada registrada en código; **no equivale a funcionalidad desplegada**.

## Convenciones del catálogo

- **Precondiciones:** actor autorizado, organización activa, ámbito de puntos cuando aplica y datos correctos.
- **Postcondiciones:** solo registros confirmados transaccionalmente son hechos de negocio.
- **Error:** usar `code`, `message` y `correlationId` del API sin exponer información clínica a terceros.
- **Pruebas:** casos canónicos enumerados en [matriz-pruebas-operativas.md](matriz-pruebas-operativas.md).

| ID | Actor | Caso | Entrada | Salida/resultado esperado | Ruta o fuente |
| --- | --- | --- | --- | --- | --- |
| UC-AT-01 | MTD | Subir y preparar AT | XLSX contractual, catálogo | Preview sin mutar AT | `POST /admin/tariff-annex/imports`, `.../prepare` |
| UC-AT-02 | MTD | Confirmar AT | Preview válido, motivación de anomalías | Productos/revisiones y auditoría | `POST /admin/tariff-annex/imports/:id/confirm` |
| UC-AUTO-01 | MTD | Cargar AUTO | XLSX con clave autorización/producto | Job y filas en staging | `POST /bulk-imports/authorizations/upload` |
| UC-AUTO-02 | MTD | Confirmar, reintentar, descargar rechazo | ID de job y estado admitido | AUTO persistidas y detalle de fallos | `/bulk-imports/:id/confirm`, `.../retry-failed`, `.../rejected.xlsx` |
| UC-AUTO-03 | MTD | Consulta/vigencia/estado | AUTO y filtros | Estado por múltiples dimensiones | `GET /authorization-query`, `/:id` |
| UC-AUTO-04 | MTD | Edición manual de AUTO | ID, datos/versionado | Modificación validada y auditable | `PATCH /authorizations/:id/manual-edit` |
| UC-AUTO-05 | MTD | Anulación sin consumo | Motivo y expectedVersion | Marca irreversible y liberación de saldo reservado | `POST /authorizations/:id/annul` |
| UC-PROG-01 | MEDICARTE | Programación por punto y fecha | AUTO, punto, fecha | Programación e historial | `/patient-schedules` |
| UC-DEM-01 | Actor autorizado | Consolidar demanda | Período de planificación | Demanda/lineage | `POST /planning-periods/:id/consolidate` |
| UC-OC-01 | MTD | OC desde demanda | Período y líneas elegibles | OC creada (emisión separada en API) | `POST /purchase-orders`, `.../:id/issue` |
| UC-OC-02 | MTD | OC vía XLSX V3 | Clave destino, OC, código, cantidad | OC nueva emitida y vínculo AUTO–OC | `POST /purchase-orders/import` |
| UC-OC-03 | MTD | Añadir saldo a OC existente | OC existente y AUTO destino | Compromiso lógico sujeto a saldo/guards | `POST /purchase-orders/import` |
| UC-OC-04 | MTD | Reasignar en OC existente | AUTO origen, destino y cantidad completa | Cambio consistente/auditable | `POST /purchase-orders/import` |
| UC-OLP-01 | OLP | Aceptar OC | Versión, fecha, managedQuantity por línea | Compromiso proveedor | `POST /supplier/purchase-orders/:id/accept` |
| UC-OLP-02 | OLP | Revisión/devolución | Línea, costo/cantidad, observación | Estado de revisión/devolución | `POST /supplier/purchase-orders/:id/lines/:lineId/review`, `.../return` |
| UC-MED-01 | MEDICARTE | Recepción física directa | OC aceptada, líneas/cantidad real | Recibo y conciliación de asignaciones | `POST /medicarte/purchase-orders/:id/receipts` |
| UC-MED-02 | MEDICARTE | Entrega o aplicación | AUTO, OC, tipo, fecha, cantidad | Fulfillment confirmado | `POST /medicarte/authorizations/:id/fulfill` |
| UC-MED-03 | MEDICARTE | Cargar fecha de dispensación | XLSX propio | Fechas actualizadas, no consumo físico | `POST /authorizations/dispensation/import` |
| UC-INV-01 | Actor autorizado | Consultar disponibilidad | Producto/OC/punto | Proyección de saldo y exportable | `GET /inventory/availability` |
| UC-INV-02 | Actor autorizado | Traslado de inventario | Lotes y puntos | Despacho/recepción de traslado | `/inventory/transfers` |
| UC-AUD-01 | Auditoría/MTD | Auditoría de facturación | AUTO, evidencia y decisión | Decisiones auditadas | `/authorization-billing-audits` |
| UC-AUD-02 | Auditoría/MTD | Auditoría masiva | XLSX/resultado por job | Resultados persistidos y exportación | `/authorization-billing-audits/bulk` |
| UC-REC-01 | Rol habilitado | Reconciliar inconsistencias | Run/issue/política | Finding/issue trazado, sin reparar automáticamente | `/reconciliation` |

**Todos los endpoints de esta tabla** son relativos a `/api/v1`. La autorización se verifica por permisos particulares, no por usar la etiqueta del actor en esta matriz.

## Casos transversales que no deben omitirse

| Código | Condición específica | Resultado esperado / tratamiento |
| --- | --- | --- |
| NEG-01 | Archivo AUTO con número y código comercial incompletos | Fila inválida; no crear AUTO ambigua |
| NEG-02 | Archivo AUTO con vigencia vencida o no en AT | Preservar evidencia si pasa identidad; bloquear operación según evaluación, no confundir con error de formato |
| NEG-03 | Carga AT con anomalía tarifaria | Requiere revisión y `overrideReason` suficiente para confirmar |
| NEG-04 | Misma AUTO en dos OC dentro de saldo | Puede repartirse en cantidades parciales, sujetas a cobertura efectiva y validación |
| NEG-05 | Misma pareja AUTO destino + OC duplicada en XLSX | Rechazo por duplicidad; no duplicar compromiso |
| NEG-06 | Reasignar unidades ya entregadas/aplicadas | Rechazo; mantener traza original |
| NEG-07 | Cambiar AUTO con snapshot de OC existente | No alterar la versión histórica de origen de compra |
| NEG-08 | OLP acepta sin fecha comprometida | Rechazo contractual/consistencia; no inventar fecha |
| NEG-09 | MEDICARTE recibe antes de aceptación OLP | Rechazo explícito |
| NEG-10 | Recepción real menor que OC | Solo cantidad recibida se vuelve candidata de disponibilidad |
| NEG-11 | Consumir más de recibido o más de reservado | Rechazo; no generar balance negativo |
| NEG-12 | Anular después de primer consumo | Rechazo irreversible, conserva evidencias |
| NEG-13 | Actor intenta accionar fuera de su organización/punto | 403 o no visibilidad según contrato, sin filtrar datos |
| NEG-14 | Operaciones concurrentes sobre OC/AUTO/stock | Una versión/lock debe evitar sobreasignación/doble consumo |

## Formato recomendado para nuevos casos

1. ID estable (`UC-MTD-...`, `UC-OLP-...`, `UC-MED-...`) y referencia al requerimiento/ADR.
2. Actor principal, perfiles/permiso, actor que recibe el resultado.
3. Disparador, precondiciones, entradas y plantilla/versiones si aplica.
4. Camino principal y caminos alternos; condiciones de error por `code`.
5. Estados y escrituras autoritativas, histórico y auditoría.
6. Invariantes, indicadores, pruebas automáticas/HTTP y **evidencia de ejecución con SHA**.

## Casos especiales complementarios

Se mantiene un catálogo versionado [CE-01 a CE-32](casos-especiales/README.md), con restricciones de edición de vigencia, producto/cantidad, liberación de reservas, auditoría de facturación, soporte Drive, auditorías de atención y conciliación. Las pruebas de esos casos figuran en [TE-01 a TE-47](casos-especiales/matriz-pruebas-especiales.md) y están **pendientes de ejecución**.
