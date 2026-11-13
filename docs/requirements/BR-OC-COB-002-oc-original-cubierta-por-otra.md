# BR-OC-COB-002 — OC original cubierta por otra OC

Caso: AUTO 262895766412139, producto 10340.
OC comercial 9363; OC con inventario para consumir 9330.

## Reglas
- Conservar el vinculo comercial original.
- Entregar solo contra reservas fisicas activas.
- La recepcion posterior no debe duplicar reservas.
- No cancelar ni desenlazar compras automaticamente.
- Producto nuevo libre: asignacion a otras AUTOs elegibles.
- Separar en UI OC para consumo y trazabilidad comercial.
- No alterar cantidades compradas, recepciones ni consumos.

## Backfill
La clasificacion se recalcula al consultar el detalle,
incluyendo registros historicos. No requiere modificar
inventario ni purchase_order_authorization_sources.

El archivo scripts/audits/backfill-oc-cubierta-por-otra-oc.sql
permite revisar los casos existentes sin escribir en BD.

Cualquier anomalia real exige otro backfill correctivo,
con dry-run, auditoria, rollback y aprobacion especifica.

## Pruebas
- OC 9330 permite el consumo; 9363 solo trazabilidad.
- Recepcion posterior de 9363 no duplica la reserva.
- La cobertura parcial no se presenta como completa.
- Varias OC fisicas pueden cubrir una misma AUTO.
- Tests de integracion, lint, typecheck y build.
