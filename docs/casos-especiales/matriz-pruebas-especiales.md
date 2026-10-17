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

## Condiciones de cierre

No declarar cobertura final hasta registrar para cada prueba: entorno, SHA, actor/organización, fixture, input, respuesta HTTP, consultas BD verificables, outbox/eventos, evidencia anonimizada, fecha, ejecutor y resultado PASS/FAIL. Ejecutar `pnpm test`, `pnpm test:integration` y smoke funcional; no asumir que tests unitarios prueban permisos o migraciones.
