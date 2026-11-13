---
name: purchase-fulfillment-integrity
description: Protege estados, cantidades y enlaces en la cadena autorización → orden → recepción → inventario → consumo de Medicarte. Úsala cuando una tarea cambie esa trazabilidad, imports que la construyen o conciliaciones que la reparan; no para presentación aislada, controles de acceso sin impacto operativo ni cambios exclusivos de esquema.
---

# Integridad del flujo Medicarte

**Entrada esperada:** comportamiento solicitado, rutas o símbolos afectados y estados/cantidades antes y después. Si no está claro qué tramo cambia, acláralo antes de proponer una edición.

1. Lee `references/evidence.md` y abre la implementación, contratos y pruebas vigentes del tramo afectado.
2. Mapea origen, autoridad y transición de cada dato. No equipares orden, entrega, recepción, reserva/asignación y consumo.
3. Identifica `DIRECT_RECEIPT` o `LOT_LEDGER`; no mezcles fuentes ni actualices ambos por conveniencia.
4. Para asignación automática de OC, contrasta `BR-AUTO-DISP-001`: stock físico libre por OC/producto/punto, prioridad de vencimiento, reserva completa de una AUTO y revalidación dentro de transacción. Distingue snapshot comercial de OC, reserva física activa y asignación histórica; ni consumo ni reasignación liberan por sí mismos unidades ya consumidas. Comprueba liberación de capacidad y continuidad de reservas con la regla vigente de vencimiento.
5. Para imports y eventos repetidos, verifica validación, deduplicación, idempotencia y enlaces creados. Para conciliaciones, distingue detección, reparación autorizada y auditoría.
6. Conserva transacciones, locks, límites acumulados, compatibilidad histórica y significado de `received`, `accepted`, `allocated`, `released`, `consumed` y `fulfilled`. Prueba reintentos y carreras por las mismas unidades.
7. Usa `rg` para consumidores y ejecuta las pruebas enfocadas indicadas en la referencia; amplía a typecheck o suite API según el riesgo. Si cruza acceso, finanzas o datos reales, aplica las fronteras de `AGENTS.md`.

**Finaliza cuando:** la cadena y sus invariantes están documentadas, cada cambio tiene prueba enfocada, no quedan cantidades o modos ambiguos y se reportan comandos ejecutados y tramos no cubiertos. Nunca pruebes contra producción.
