---
name: purchase-fulfillment-integrity
description: Protege estados, cantidades y enlaces en la cadena autorización → orden → recepción → inventario → consumo de Medicarte. Úsala cuando una tarea cambie esa trazabilidad, imports que la construyen o conciliaciones que la reparan; no para presentación aislada, controles de acceso sin impacto operativo ni cambios exclusivos de esquema.
---

# Integridad del flujo Medicarte

**Entrada esperada:** comportamiento solicitado, rutas o símbolos afectados y estados/cantidades antes y después. Si no está claro qué tramo cambia, acláralo antes de proponer una edición.

1. Lee `references/evidence.md` y abre la implementación, contratos y pruebas vigentes del tramo afectado.
2. Mapea origen, autoridad y transición de cada dato. No equipares orden, entrega, recepción, reserva/asignación y consumo.
3. Identifica `DIRECT_RECEIPT` o `LOT_LEDGER`; no mezcles fuentes ni actualices ambos por conveniencia.
4. Para imports, verifica validación, deduplicación, idempotencia y enlaces creados. Para conciliaciones, distingue detección, reparación autorizada y auditoría.
5. Conserva transacciones, locks, límites acumulados, compatibilidad histórica y significado de `received`, `accepted`, `allocated`, `consumed` y `fulfilled`.
6. Usa `rg` para consumidores y ejecuta las pruebas enfocadas indicadas en la referencia; amplía a typecheck o suite API según el riesgo.

**Finaliza cuando:** la cadena y sus invariantes están documentadas, cada cambio tiene prueba enfocada, no quedan cantidades o modos ambiguos y se reportan comandos ejecutados y tramos no cubiertos. Nunca pruebes contra producción.
