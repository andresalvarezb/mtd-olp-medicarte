---
name: medicarte-flow-integrity
description: Protege la trazabilidad autorización → orden → recepción → inventario → consumo en Medicarte. Úsala al cambiar cualquiera de esos módulos, sus importaciones, conciliaciones o pruebas.
---

# Integridad del flujo Medicarte

1. Lee `references/evidence.md` y abre las fuentes actuales que correspondan al cambio.
2. Dibuja la cadena afectada y nombra la autoridad de datos en cada tramo. No equipares orden, entrega, recepción, asignación y consumo.
3. Identifica explícitamente el modo `DIRECT_RECEIPT` o `LOT_LEDGER`; no mezcles sus fuentes ni actualices ambos por conveniencia.
4. Conserva transacciones, bloqueos, idempotencia, límites de cantidades y auditoría. Comprueba el sentido de `received`, `accepted`, `allocated`, `consumed` y `fulfilled`.
5. Revisa rutas históricas y de recuperación antes de cambiar joins o compatibilidad legacy.
6. Ejecuta primero las pruebas enfocadas de fulfillment/receipts/purchase-orders y luego typecheck o suite más amplia según el riesgo.

Entrega un resumen de invariantes comprobadas, pruebas ejecutadas y cualquier tramo no cubierto. Nunca pruebes contra producción.
