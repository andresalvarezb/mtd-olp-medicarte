# Matriz de pruebas de casos especiales

**Estado de todas las filas:** `PENDIENTE DE EJECUCIÓN`. Esta matriz expresa comportamiento esperado según el código inspeccionado, no resultados de CI. Crear fixtures **sintéticos** y limpiar recursos de ensayo.

| ID | Escenario | Resultado o control esperado | Evidencia mínima |
| --- | --- | --- | --- |
| TE-01 | MTD amplía vigencia válida con versión actual | Fecha nueva, versión +1, auditoría | API, before/after |
| TE-02 | MTD envía 2026-02-30 | Rechazo validación fecha real | HTTP, body |
| TE-03 | Estado 16 → fecha posterior >= hoy Bogotá | Estado efectivo 5 y evidencia de promoción | source_data, audit_event |
| TE-04 | Estado 16 → misma fecha/retroceso | Sin promoción; conforme reglas fecha | API y BD |
| TE-05 | Recarga XLSX 16 desactualizada tras renovación | `AUTHORIZATION_RENEWAL_STALE_RELOAD`, sin regresión | importación, BD |
| TE-06 | Vigencia anterior a atención | `AUTHORIZATION_VALIDITY_BEFORE_FULFILLMENT` | API y atención original |
| TE-07 | Edición MTD con expectedVersion obsoleto | `AUTHORIZATION_VERSION_CONFLICT` | API, auditoría |
| TE-08 | Otra organización intenta editar | 403/rechazo de alcance efectivo MTD | permisos |
| TE-09 | Cambiar producto no incluido/activo en AT | `AUTHORIZATION_PRODUCT_NOT_ACTIVE` | API, catálogo |
| TE-10 | Cambiar cantidad bajo mínimo AT | `AUTHORIZATION_BELOW_MINIMUM_QUANTITY` | API, catálogo |
| TE-11 | Cambiar a producto repetido para AUTO | `AUTHORIZATION_IDENTITY_CONFLICT` | API y unicidad |
| TE-12 | Cambiar producto con una entrega confirmada | `AUTHORIZATION_PRODUCT_ALREADY_FULFILLED` | fuente consumo |
| TE-13 | Reducir cantidad por debajo de ya entregada | `AUTHORIZATION_QUANTITY_BELOW_FULFILLED` | cantidad final |
| TE-14 | Aplicación en borrador + edición producto/cantidad | `AUTHORIZATION_DRAFT_APPLICATION_EXISTS` | DRAFT preservado |
| TE-15 | Varias programaciones activas + cambio cantidad | `AUTHORIZATION_SCHEDULE_RECONCILIATION_COMPLEX` | versiones scheduling |
| TE-16 | Varias líneas OC MTD mutables | `AUTHORIZATION_PO_RECONCILIATION_COMPLEX` | OC intactas |
| TE-17 | OC con aceptación OLP + cambio producto | No reescribir OC histórica | OC before/after |
| TE-18 | Una OC MTD elegible + cambio producto | Reconciliación controlada, auditoría | links y línea OC |
| TE-19 | Cambio producto con reservas sin consumo | Liberación completa no consumida | ledger allocations |
| TE-20 | Reducción cantidad con reserva | Liberar solo exceso | cantidades antes/después |
| TE-21 | Aumento cantidad sin reserva adicional | Ningún stock inventado | inventario por OC |
| TE-22 | Worker en día de vencimiento | Cero liberaciones; outbox invalidación | outbox y allocations |
| TE-23 | Worker ejecutado dos veces mismo día | Sin duplicados por clave idempotente | outbox |
| TE-24 | Worker con scheduler deshabilitado | Sin ejecución periódica | config y logs |
| TE-25 | Anulación antes de cualquier atención | Liberación de reservas y fuentes; OC preservada | BD y audit_event |
| TE-26 | Anulación con cumplimiento parcial | Rechazo `AUTHORIZATION_ALREADY_ATTENDED` | fulfilment conservado |
| TE-27 | Anulación concurrente a fulfillment | Uno gana; no inventario negativo ni doble consumo | transacciones |
| TE-28 | Auditoría sin atención pero con reserva | `AUTHORIZATION_BILLING_AUDIT_NOT_ELIGIBLE` | snapshot fuente |
| TE-29 | Auditoría con cumplimiento parcial | Permitir inicio según elegibilidad | estado PENDING |
| TE-30 | Marcar NO CUMPLE sin observación | Rechazo validación | API |
| TE-31 | Auditoría sin soportes y CUMPLE sin observación | Rechazo por falta de observación | API |
| TE-32 | Auditoría ya REVIEWED y cambio de decisión | No se reabre ni sobreescribe | auditId |
| TE-33 | Búsqueda Drive PDF por nombre exacto | Soporte y metadatos visibles | respuesta IDs sintéticos |
| TE-34 | Drive PDF con nombre distinto, coincidencia fullText | Incluye soporte válido en carpeta raíz | evidencia |
| TE-35 | PDF fuera de carpetas raíz | No se incorpora | permisos Drive |
| TE-36 | Varios PDFs misma AUTO | Deduplicación por fileId; múltiples soportes | expediente |
| TE-37 | Soporte desaparece de Drive y sync exitoso | `is_present=false`, historia retenida | tabla soportes |
| TE-38 | Error de Drive | Retry y `UNKNOWN`/error; no concluir ausencia | estado sync |
| TE-39 | Bulk facturación con encabezados errados | `INVALID_HEADERS` | fichero resultado |
| TE-40 | Bulk con más de 5000 filas | Rechazo por límite | respuesta |
| TE-41 | Bulk CUMPLE/NO CUMPLE en texto | Mapeo a resultado interno; rows | informe XLSX |
| TE-42 | Dos auditores confirman misma AUTO | Solo primera decisión válida | transacciones |
| TE-43 | Rechazo de aplicación con OTHER sin observación | Error de contrato | HTTP |
| TE-44 | Auditoría de aplicación con versión vieja | Conflicto sin alterar resultado | estado posterior |
| TE-45 | Conciliación con permiso faltante | 403; no ejecución | logs/autorización |
| TE-46 | Incidencia resuelta y alerta no marcada leída | Estado de incidencia y notificación independientes | BD y UI |
| TE-47 | Recepción repetida/fragmentada + conciliación | No crear consumo ni doble asignación | OC/recibos/allocations |

## Matriz adicional CE-33 a CE-84 (TE-48 a TE-97)

Todos los siguientes casos son **PENDIENTES**, no pruebas ejecutadas. Para brechas funcionales la aceptación consiste en **documentar bloqueo, decisión y ausencia de efecto indebido**, no suponer que el endpoint existe.

| ID | Escenario | Resultado esperado | Evidencia mínima |
| --- | --- | --- | --- |
| TE-48 | PBS con autorización operable | Gate MIPRES no requiere decisión manual; otros filtros continúan | API + DB + auditoría / acta RF |
| TE-49 | NO PBS sin desbloqueo | Sigue bloqueado hasta decisión MANUALLY_ENABLED | API + DB + auditoría / acta RF |
| TE-50 | NO PBS sin prescripción intenta ENABLE | MIPRES_DECISION_NOT_APPLICABLE | API + DB + auditoría / acta RF |
| TE-51 | NO PBS con AUTO DISABLED intenta ENABLE | MIPRES_ENABLE_REQUIRES_ELIGIBLE_AUTHORIZATION | API + DB + auditoría / acta RF |
| TE-52 | NO PBS con AUTO PENDING manual ENABLE | MIPRES desbloquea; AUTO sigue PENDING | API + DB + auditoría / acta RF |
| TE-53 | Decision MIPRES expectedVersion obsoleta | MIPRES_DECISION_VERSION_CONFLICT | API + DB + auditoría / acta RF |
| TE-54 | Concepto MIPRES equivocado | MIPRES_DECISION_CONCEPT_INVALID | API + DB + auditoría / acta RF |
| TE-55 | Concepto MIPRES que exige nota sin observación | MIPRES_DECISION_NOTE_REQUIRED | API + DB + auditoría / acta RF |
| TE-56 | Recheck externo con timeout | QUERY_ERROR; no inventar rechazo | API + DB + auditoría / acta RF |
| TE-57 | Dirección con maximumDeliveryDate igual a hoy Bogotá | No vigente | API + DB + auditoría / acta RF |
| TE-58 | Inasistencia PATIENT_NO_SHOW | NOT_APPLIED con novedad y trazabilidad | API + DB + auditoría / acta RF |
| TE-59 | No aplicación por INSUFFICIENT_STOCK | Evento NOT_APPLIED sin aplicación ficticia | API + DB + auditoría / acta RF |
| TE-60 | No aplicado NON_REUSABLE con 2 lotes | Movimiento negativo por lote y auditoría | API + DB + auditoría / acta RF |
| TE-61 | No aplicado REUSABLE con nonReusableLines | Validación rechaza líneas no reutilizables | API + DB + auditoría / acta RF |
| TE-62 | Producto no reutilizable con cantidad > programada | PATIENT_OUTCOME_QUANTITY_EXCEEDED | API + DB + auditoría / acta RF |
| TE-63 | Producto no reutilizable con saldo insuficiente | PATIENT_OUTCOME_INSUFFICIENT_BALANCE | API + DB + auditoría / acta RF |
| TE-64 | Not-applied duplicado misma revisión | No duplica inventario ni resultado | API + DB + auditoría / acta RF |
| TE-65 | Cancelar programación CANCELLED y luego reprogramar | Rechazo transición terminal | API + DB + auditoría / acta RF |
| TE-66 | Reprogramar con expectedRevision obsoleta | Conflicto sin cambio | API + DB + auditoría / acta RF |
| TE-67 | Programación LATE sin lateHandling | PATIENT_SCHEDULE_LATE_HANDLING_REQUIRED | API + DB + auditoría / acta RF |
| TE-68 | Programación NEXT_PERIOD sin siguiente período | PATIENT_SCHEDULE_NEXT_PERIOD_NOT_FOUND | API + DB + auditoría / acta RF |
| TE-69 | Recepción legacy accepted+rejected difiere received | RECEIPT_QUANTITY_SUM_INVALID | API + DB + auditoría / acta RF |
| TE-70 | Recepción legacy recibida supera despachada | RECEIPT_OVER_RECEIVED | API + DB + auditoría / acta RF |
| TE-71 | Recepción legacy acepta sin lote/vencimiento | RECEIPT_LOT_EXPIRATION_REQUIRED | API + DB + auditoría / acta RF |
| TE-72 | Recepción legacy acepta producto vencido | RECEIPT_EXPIRED_PRODUCT | API + DB + auditoría / acta RF |
| TE-73 | Recepción legacy faltante parcial | Entrega no necesariamente finalizada; acumular saldo | API + DB + auditoría / acta RF |
| TE-74 | Recepción directa OC parcial | RECEIVED_PARTIAL; sin evidencia de lote físico | API + DB + auditoría / acta RF |
| TE-75 | Recepción directa repetida misma OC | No duplicar unidades ni asignación AUTO | API + DB + auditoría / acta RF |
| TE-76 | Recepción confirmada intenta PATCH | RECEIPT_FROZEN | API + DB + auditoría / acta RF |
| TE-77 | Traslado despacho con stock insuficiente | STOCK_TRANSFER_INSUFFICIENT_BALANCE | API + DB + auditoría / acta RF |
| TE-78 | Traslado de lote expirado | STOCK_TRANSFER_EXPIRED_STOCK | API + DB + auditoría / acta RF |
| TE-79 | Traslado fuera del punto del usuario | Denegación alcance de punto | API + DB + auditoría / acta RF |
| TE-80 | Traslado RECEIVED intentar CANCEL | STOCK_TRANSFER_CANCEL_NOT_ALLOWED | API + DB + auditoría / acta RF |
| TE-81 | Traslado versión vieja | Version conflict; no duplica ledger | API + DB + auditoría / acta RF |
| TE-82 | Traslado despachado con pérdida en tránsito | Escalamiento/pendiente funcional RF-02; no falso recibo | API + DB + auditoría / acta RF |
| TE-83 | Devolución proveedor tras recepción confirmada | RF-01: pendiente; no endpoint inventado | API + DB + auditoría / acta RF |
| TE-84 | Producto dañado en recepción | DAMAGED_PRODUCT y cantidades rechazadas | API + DB + auditoría / acta RF |
| TE-85 | Caducado almacenado sin atención | RF-04: no ajuste inventado | API + DB + auditoría / acta RF |
| TE-86 | Tarifa COMPENSAR diferente costo OLP | Snapshots separados y métricas correctas | API + DB + auditoría / acta RF |
| TE-87 | Tarifa AT modificada después de OC | No reescribir historia sin regla | API + DB + auditoría / acta RF |
| TE-88 | Usuario analytics.read solicita economics | 403 sin economics.read | API + DB + auditoría / acta RF |
| TE-89 | Export.xlsx con analytics.read sin economics.read | Archivo sin columnas económicas | API + DB + auditoría / acta RF |
| TE-90 | Auditoría NO CUMPLE equivale a nota crédito | No registrar contabilización automática | API + DB + auditoría / acta RF |
| TE-91 | Factura OLP vs factura COMPENSAR | RF-06: pendiente; datos externos requeridos | API + DB + auditoría / acta RF |
| TE-92 | MEDICARTE intenta decisión MIPRES | Denegación MTD only | API + DB + auditoría / acta RF |
| TE-93 | COMPENSAR_VIEWER intenta escritura | Denegación por permisos de backend | API + DB + auditoría / acta RF |
| TE-94 | Rol personalizado cambiado con asignaciones incompatibles | ROLE_SCOPE_ASSIGNMENTS_CONFLICT | API + DB + auditoría / acta RF |
| TE-95 | Rol MTD_ADMIN intenta desactivación | ROLE_PROTECTED | API + DB + auditoría / acta RF |
| TE-96 | Revocación grant de punto antes de mutar | Denegación al revalidar y sin saldo negativo | API + DB + auditoría / acta RF |
| TE-97 | Usuario doble organización cambia X-Organization-Id | No mezcla datos/permisos entre organizaciones | API + DB + auditoría / acta RF |

## Condiciones de cierre

No declarar cobertura final hasta registrar para cada prueba: entorno, SHA, actor/organización, fixture, input, respuesta HTTP, consultas BD verificables, outbox/eventos, evidencia anonimizada, fecha, ejecutor y resultado PASS/FAIL. Ejecutar `pnpm test`, `pnpm test:integration` y smoke funcional; no asumir que tests unitarios prueban permisos o migraciones.
