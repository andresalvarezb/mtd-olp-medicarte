# Cobertura, lagunas y trabajo pendiente

**Respuesta a «¿ya cubriste todo?»** No. Este paquete cubre por lectura estática los **casos especiales identificados y priorizados**, no el 100 % de operaciones, estados, pantallas y decisiones de negocio. No hay prueba de integración, UAT ni despliegue verificado en esta revisión.

## Estado actualizado de la ampliación — 2026-10-17

Se realizó revisión específica de las excepciones previamente listadas en esta guía. Véase [índice CE-33 a CE-84](README.md) y [brechas RF-01 a RF-10](pendientes-funcionales-priorizados.md).

| Excepción | Cobertura documental actual | Límite de implementación/validación |
| --- | --- | --- |
| MIPRES PBS/NO PBS | **Ampliada**: decisión MTD, vigencia, recheck, fallas, motivos y gates | Falta ejecución real con MIPRES/fixtures y aprobación operativa |
| No asistencia/reprogramación | **Ampliada**: novedad, disposición producto, historial y fechas tardías | Política de liberación/reuso requiere decisión explícita |
| Recepción parcial/lotes | **Ampliada**: legacy y directa OC, rechazos, acumulados y cantidades | Recepción directa no captura lotes; corregir confirmada requiere proceso |
| Traslados/daños/devoluciones | **Ampliada**: estados y movimientos comprobados | No se halló reversión completa, merma genérica o devolución posrecepción |
| Conciliación financiera | **Ampliada**: campos tarifarios y costos, indicadores, límites de auditoría | Sin cierre contable/facturas/glosas/pagos integral verificado |
| Permisos complejos | **Ampliada**: roles, permisos, puntos, ejemplos cruzados | No hay pruebas UAT de todas las combinaciones/usuarios reales |

**La cobertura documental fue ampliada; los pendientes funcionales RF y las pruebas por ejecutar siguen abiertos.**

## Mapa de cobertura del manual

| Grupo | Nivel documental actual | Brecha pendiente |
| --- | --- | --- |
| Carga masiva AUTO / OC / AT | Guías previas + endpoints y plantillas | Prueba visual, escenarios por fila y transacciones reales |
| Vigencia y estado 16→5 | Regla, contrato, excepciones y auditoría | Validación histórica de fechas y de todas las vistas |
| Cambio de producto/cantidad | Impacto OC/programación/inventario y errores | Pruebas de cruces con OC recibidas, consumo y concurrencia |
| Anulación y reservas | Condiciones, liberación y permanencia histórica | Verificar reparaciones antiguas, reversos y carreras |
| Vencimiento automático | **Se documenta política sin liberación** | Acordar si negocio desea liberar al vencer; implicaría **nuevo requerimiento** |
| Facturación | Individual/XLSX, soportes, estado definitivo | Validación con facturación operativa, retención y permisos |
| Soportes Drive | Búsqueda, metadata, sincronización opcional | Indexación real, permisos Drive, cifrado y ciclo documental |
| Auditoría aplicación/fulfillment | Contratos y rutas | Revisar en profundidad repositorio/servicios y regla de reintento |
| Conciliación | Flujos, alertas y permisos base | Analizar cada regla, operación automática y consecuencias |
| MIPRES / PBS / NO PBS | Referencias y separación de gates | Manual completo de evidencias, fallas externas y decisión manual |
| Programación y no asistencia | Flujo principal documentado | Reprogramaciones, tardíos, reuso y asignación por punto |
| Recepciones/traslados/daños/devoluciones | Flujo principal e inventario | Manual de diferencias de lote, vencimiento, devolución y transferencias |
| Facturación y costos | Distinción tarifa Compensar/costo OLP | Conciliación financiera, cortes, exportables y rechazo de soporte |
| RBAC, auditoría técnica, trazas y datos sensibles | Controles generales | Matriz exacta por rol, datos personales, retención y respuesta a incidentes |

## Riesgos concretos de interpretación

1. **Nombre engañoso de worker de liberación:** el scheduler corre, pero no libera reservas por vencimiento. No alterar la política solo para hacerla coincidir con el nombre.
2. **Condición de vigencia vs compra:** [BR-AUTO-REN-001](../requirements/BR-AUTO-REN-001-estado-16-vigencia.md) registra una diferencia histórica entre vigencia de consulta y elegibilidad de compra, pendiente de decisión separada.
3. **Stock directo vs ledger legacy:** recepción directa por OC y `receipts` ligados a `deliveries` tienen reglas distintas; no sumar dos representaciones sin reconciliación.
4. **Soporte documental ≠ conformidad de auditoría:** un PDF hallado por nombre o texto requiere inspección humana y validaciones de contexto.
5. **Decisiones `REVIEWED`:** no es correcto modificar decisiones de auditoría mediante SQL ad hoc; cambios requieren proceso formal de corrección/auditoría.
6. **Rama móvil:** esta documentación observa `develop` al SHA indicado. Verificar cambios posteriores antes de promover afirmaciones.

## Prioridades de documentación siguiente

- **P0:** validar en ambiente de integración las 47 pruebas de casos especiales; conciliar diferencias con negocio antes de publicar manual certificado.
- **P0:** definir formalmente política de liberación por vencimiento: mantener reserva, reubicar mediante acción humana, o automatizarla con criterios de seguridad. La implementación actual **no libera**.
- **P1:** manual MIPRES: estados, actualización/errores de dispensación, reversos, evidencia y semántica de PBS / NO PBS.
- **P1:** manual de corrección posrecepción: OC entregada, recepción parcial, lotes, trazabilidad, excedentes, reuso y transferencias.
- **P1:** auditoría financiera: soportes, cierre, novedades, costos y conciliación exportable.
- **P2:** captura validada de pantallas reales por perfil y flujogramas BPMN con versionado.

## Método de actualización continua

Registrar cada nueva regla como caso de uso `CE-XX`, con actor, precondición, contrato, estados, efectos contables/físicos, ejemplos sintéticos, errores, evento de auditoría, pruebas y referencia exacta a código/commit. Una regla propuesta debe etiquetarse **PENDIENTE DE DECISIÓN**, nunca como implementada. Conservar ADR históricos, no editarlos para aparentar comportamiento actual.
