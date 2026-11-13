# RF-MTD-CM-002 — Recaudo flexible, devoluciones e invalidaciones

**Estado:** aprobado; implementación local sujeta a validación de integración y despliegue controlado.

## Objetivo y alcance

MTD registra dinero efectivamente recibido y devuelto por cuota moderadora, con independencia de habilitación, vigencia, anulación, cierre, inventario, órdenes de compra y entregas. `NOT_COLLECTED` informa ausencia de recaudo y no equivale a una devolución. MEDICARTE consulta dentro de su alcance por punto; solo MTD con `moderator_fees.manage` crea movimientos. La API valida permiso y organización en cada operación.

El dinero se asigna a una autorización identificada inequívocamente. Si un número histórico tiene varios ítems, se bloquean movimientos nuevos hasta que un responsable financiero concilie la identidad; no se asigna a un producto arbitrario.

## Reglas y transiciones

| Estado actual | Movimiento | Estado nuevo | Condición |
| --- | --- | --- | --- |
| NOT_RECORDED, NOT_COLLECTED, REFUNDED, INVALIDATED | COLLECTED | COLLECTED | Dinero recibido; sin recaudo activo; valor fuente positivo completo o valor real manual justificado. |
| NOT_RECORDED, NOT_COLLECTED, REFUNDED, INVALIDATED | NOT_COLLECTED | NOT_COLLECTED | No se recibió dinero. |
| COLLECTED | REFUNDED | REFUNDED | Devolución total efectiva, motivo, fecha no futura, importe igual al recaudo y referencia al evento original. |
| COLLECTED | INVALIDATED | INVALIDATED | Recaudo original erróneo, motivo y confirmación de que nunca se recibió dinero. |

No se admiten devoluciones parciales, un segundo recaudo activo, doble reversión ni `NOT_COLLECTED` para ocultar un recaudo activo. Un `NOT_COLLECTED` histórico posterior a `COLLECTED` conserva su significado anterior; no se interpreta como devolución. La versión esperada, la clave de idempotencia y el bloqueo `FOR UPDATE` de la autorización serializan las escrituras. Los eventos son inmutables en PostgreSQL.

El valor fuente válido y positivo se precarga y se exige completo. Si falta, es cero o inválido, MTD informa el importe real positivo, marca valor manual y escribe observación. Se auditan valor fuente, diferencia, origen manual, usuario, organización, fecha efectiva, fecha de registro, motivo, referencia, evento relacionado y versión. El total recaudado suma eventos `COLLECTED` no invalidados; total devuelto suma `REFUNDED`; saldo neto es su diferencia. Un recaudo devuelto sigue siendo dinero recibido históricamente.

## API, datos y exportables

`GET /medicarte/authorizations/:id/moderator-fee` devuelve estado, importe esperado, totales y eventos con estado de sincronización. `POST /medicarte/authorizations/:id/moderator-fee` acepta `COLLECTED`, `NOT_COLLECTED`, `REFUNDED` e `INVALIDATED`; estos dos últimos incluyen `relatedEventId` y motivo. `POST /medicarte/authorizations/:id/moderator-fee/events/:eventId/retry-sync` permite a MTD reintentar eventos pendientes o fallidos. Todos requieren organización y autenticación; escritura requiere `moderator_fees.manage`.

La migración `0120_moderator_fee_financial_movements.sql` es aditiva, conserva todas las filas antiguas y amplía las restricciones. Agrega `moderator_fee_sheet_sync` para observar intentos y fallos. El exportable de autorizaciones añade total recaudado, total devuelto y neto; cada autorización aparece una sola vez y no suma versiones como pagos independientes.

La cola genérica `outbox_events` despacha tipos conocidos y marca los demás como procesados; por eso la entrega a Sheets usa un registro específico persistente enlazado al evento financiero. Se puede reintentar por API sin modificar el evento.

## Google Sheets, facturación y conciliación

Una fila `NOT_COLLECTED` lleva valor recibido cero y se envía a la pestaña informativa `<hoja>_MOVIMIENTOS`, separada de la pestaña de facturación. Los nuevos movimientos enviados a la hoja incluyen ID de evento para detectar reintentos; el sincronizador comprueba ese ID antes de agregar una fila. Si Sheets falla, la transacción financiera ya confirmada permanece en BD y la sincronización queda `FAILED` o `PENDING` para reintento. Revisar esos estados periódicamente y usar el endpoint de reintento tras corregir la causa. Si el resultado remoto fue incierto, buscar primero el ID del evento en la hoja correspondiente.

Una devolución o invalidación se agrega a la pestaña informativa con su saldo neto y queda `RECONCILIATION_REQUIRED`: el sistema no declara factura anulada ni reembolsada porque la integración actual solo agrega filas y consulta facturas. Si esa sincronización informativa falla, el estado es `FAILED` hasta el reintento. El equipo contable debe verificar el recaudo original, ejecutar la nota crédito o reversión en el sistema facturador según su procedimiento, conservar el soporte y registrar la correspondencia externa. Las filas financieras históricas de Sheets no se reescriben. Las devoluciones reales y las invalidaciones de error tienen tratamientos contables distintos.

Antes de activar la nueva pestaña, facturación debe revisar filas históricas `NOT_COLLECTED` que pudieron llevar el valor esperado en `CopagoVALOR`; cualquier corrección de factura u hoja exige conciliación manual documentada. La migración no cambia esas filas.

## Escenarios y aceptación

- Un operador MTD registra dinero recibido en autorizaciones pendientes, vencidas, anuladas, cerradas, sin OC, inventario o cumplimiento. La interfaz advierte el contexto operativo sin utilizarlo como condición de escritura.
- Un operador informa ausencia de pago sin crear un recaudo ni valor recibido.
- Después de devolver totalmente o invalidar el evento activo, otro pago real puede registrarse con nueva clave y versión.
- Una segunda reversión, un importe parcial, un motivo vacío, una fecha futura o un usuario MEDICARTE en escritura son rechazados.
- El historial conserva los eventos anteriores a la migración y no cambia inventario, órdenes ni entregas.

## Despliegue y reversión

1. Ejecutar controles de esquema, contratos, API, web, exportables y pruebas de integración en un ambiente aislado. Revisar permisos y casos históricos ambiguos.
2. Respaldar BD y hoja, desplegar primero la migración aditiva y después API y web compatibles. Verificar salud de la aplicación y estados pendientes de sincronización con datos no sensibles.
3. Habilitar operación solo tras acordar con facturación la conciliación manual de devoluciones e invalidaciones y monitoreo de `FAILED`/`RECONCILIATION_REQUIRED`.
4. Para reversión funcional, retirar API/web nuevos y mantener columnas, tabla y eventos: eliminarlos destruiría trazabilidad. Resolver movimientos pendientes y facturación por conciliación contable, sin reinterpretar datos antiguos.

No se ejecutan migraciones ni operaciones de producción durante esta implementación local.
