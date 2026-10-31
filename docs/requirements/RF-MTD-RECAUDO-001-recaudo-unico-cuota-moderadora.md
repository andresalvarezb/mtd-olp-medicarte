# RF-MTD-RECAUDO-001 — Recaudo único de cuota moderadora

**Estado:** aprobado funcionalmente; implementado localmente, pendiente de integración
**Ámbito:** MTD y consulta financiera de MEDICARTE
**Unidad de recaudo:** autorización de un único producto y N unidades

## Objetivo

Permitir que MTD registre el 100 % de la cuota moderadora una sola vez por
autorización. Cada autorización corresponde a un único producto y puede tener N
unidades atendidas en una o varias entregas o aplicaciones. El recaudo debe ser
auditable e idempotente y no debe alterar la operación logística.

## Responsables y permisos

| Actor     | Responsabilidad                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| MTD       | Consultar elegibilidad y estado; registrar el recaudo completo; registrar correcciones por el flujo autorizado. |
| MEDICARTE | Consultar el estado financiero dentro de su alcance operativo. No puede registrar recaudos ni correcciones.     |
| Sistema   | Validar elegibilidad, monto, unicidad e idempotencia; conservar historial y auditoría.                          |

La autorización funcional para registrar no reemplaza los controles vigentes de
identidad, organización, punto y recurso. La interfaz de usuario no constituye
por sí sola una frontera de seguridad.

## Unidad financiera y monto

- La obligación se identifica a nivel de **autorización**, no de producto ni de
  entrega/aplicación.
- El único monto admisible es el 100 % de la cuota moderadora autorizada. No se
  admiten abonos, fraccionamientos ni valores proporcionales.
- Una fila de `authorization_items` representa la autorización aprobada cuando
  su número no aparece asociado a otro producto. Los números históricos con
  varias filas/productos son ambiguos y se bloquean para conciliación.
- Una entrega o aplicación posterior no crea una nueva obligación financiera.

## Matriz de elegibilidad

| Situación de la autorización                                        | ¿MTD puede recaudar? | Condición verificable                                                                     |
| ------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Sin entrega/aplicación y sin producto asignado o reserva activa     | No                   | No existe soporte operativo previo.                                                       |
| Sin entrega/aplicación, con producto asignado y reserva activa      | Sí                   | Existe una asignación vigente con saldo reservado mayor que cero.                         |
| Con entrega o aplicación parcial confirmada                         | Sí                   | Existe al menos un cumplimiento confirmado; se recauda el 100 %, no una proporción.       |
| Con entrega o aplicación completa confirmada                        | Sí                   | El cumplimiento confirmado permite el recaudo aun cuando la reserva ya se haya consumido. |
| Con recaudo efectivo registrado, aunque luego exista una corrección | No                   | Un evento histórico `COLLECTED` cierra la obligación.                                     |
| Con monto fuente ausente o inválido                                 | No                   | Requiere conciliación antes de registrar.                                                 |
| Número histórico asociado a varios productos                        | No                   | La identidad financiera es ambigua y requiere conciliación.                               |
| Autorización anulada                                                | No                   | `annulled_at` impide crear un recaudo nuevo.                                              |
| Solicitud de MEDICARTE para registrar                               | No                   | MEDICARTE tiene acceso de consulta únicamente.                                            |

Para la condición previa a la primera entrega/aplicación, una reserva activa es
una asignación de inventario vinculada a un ítem de la autorización, en estado
operativo (`ALLOCATED` o `PARTIALLY_CONSUMED`) y con
`allocated_quantity - consumed_quantity - released_quantity > 0`. La futura
implementación debe contrastar esta definición con el modelo operacional
vigente y no inferir reserva a partir de una OC, una recepción o una selección
en pantalla.

## Reglas de negocio

1. MTD registra el 100 % de la cuota moderadora una sola vez por autorización.
2. Antes de cualquier entrega o aplicación, el recaudo exige producto asignado
   y reserva activa comprobable.
3. Después de una entrega o aplicación parcial confirmada, MTD puede registrar
   la cuota completa.
4. Después de una entrega o aplicación completa confirmada, MTD también puede
   registrar la cuota completa.
5. No se admiten abonos ni cobros proporcionales.
6. Completar entregas o aplicaciones posteriores no habilita otro recaudo.
7. MEDICARTE consulta el estado financiero; únicamente MTD registra el recaudo.
8. Registrar o corregir el recaudo no modifica inventario, asignaciones,
   reservas, entregas ni aplicaciones.
9. Todo intento debe preservar historial inmutable, idempotencia y trazabilidad
   de correcciones.

## Excepciones y correcciones

- Un reintento con la misma clave de idempotencia y el mismo contenido devuelve
  el resultado original; con contenido distinto se rechaza como conflicto.
- Dos solicitudes concurrentes para la misma autorización no pueden producir
  dos recaudos, aunque usen ítems o claves de idempotencia diferentes.
- Una corrección debe agregar evidencia, actor, fecha, motivo y referencia al
  evento corregido. No debe editar ni eliminar el historial.
- Corregir datos descriptivos o el estado informado no rehabilita
  automáticamente un segundo recaudo. Una reversión financiera, si el negocio
  la aprueba, requiere un flujo explícito y trazable distinto de un nuevo cobro.
- Las inconsistencias de monto o identidad se resuelven por conciliación; no se
  corrigen modificando inventario ni cumplimientos.

## Identidad financiera y compatibilidad histórica

### Implementación vigente

`authorization_items` identifica cada fila mediante
`(numero_autorizacion, codigo_medicamento)` y deriva `authorization_key` de la
autorización y el producto. La regla aprobada establece que una autorización
real tiene un solo producto; bajo esa invariante, `authorization_item_id`
identifica unívocamente la autorización y el bloqueo `FOR UPDATE` serializa sus
eventos financieros concurrentes.

El esquema permite datos históricos que no cumplen la invariante. El servicio
no extrapola que `numero_autorizacion` sea una clave global ni comparte eventos
entre productos: cuenta las filas con el mismo número y bloquea cualquier
registro nuevo cuando hay más de una, dejando el caso para conciliación.

### Garantías implementadas

1. El registro bloquea la fila de autorización antes de leer o escribir eventos.
2. Cualquier `COLLECTED` histórico impide un nuevo cobro, incluso si el último
   evento es una corrección `NOT_COLLECTED`.
3. La idempotencia se resuelve antes de revalidar condiciones operativas, de
   modo que un reintento idéntico devuelve el resultado original.
4. La cuota procede del snapshot fuente de la autorización; el cliente no puede
   decidir un valor parcial, superior o proporcional.
5. No se modifica esquema: la invariante aprobada hace suficiente el identificador
   de ítem para datos válidos y los históricos ambiguos se bloquean explícitamente.

## Implementado y pendiente

| Capacidad                                                            | Estado observado                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Eventos inmutables con versión, idempotencia y auditoría             | Implementado por `authorization_item_id`.                        |
| Validación del monto completo contra la fuente del ítem              | Implementada por ítem.                                           |
| Consulta por MTD y MEDICARTE con alcance; escritura exclusiva de MTD | Implementada.                                                    |
| Separación entre recaudo y mutaciones logísticas                     | Implementada en el flujo financiero vigente.                     |
| Unicidad para una autorización válida de un producto                 | Implementada por ítem, lock y revisión de todo el historial.     |
| Elegibilidad por reserva activa antes del primer cumplimiento        | Implementada con saldo reservado positivo y estado activo.       |
| Elegibilidad después de cumplimiento parcial o completo              | Implementada por existencia de fulfillment confirmado positivo.  |
| Datos históricos con varias líneas/productos para el mismo número    | Bloqueados para conciliación; no se infiere una clave global.    |
| Corrección sin posibilidad de reabrir un segundo cobro               | Implementada; cualquier `COLLECTED` previo cierra la obligación. |

## Criterios de aceptación

1. **CA-01:** dada una autorización sin cumplimiento, sin asignación o sin
   reserva activa, cuando MTD intenta recaudar, el sistema rechaza la operación
   sin crear un evento financiero.
2. **CA-02:** dada una autorización sin cumplimiento, con producto asignado y
   reserva activa, MTD puede registrar exactamente el 100 % de la cuota.
3. **CA-03:** dada una entrega o aplicación parcial confirmada, MTD puede
   registrar una sola vez el 100 % de la cuota, incluso si queda saldo pendiente.
4. **CA-04:** dada una entrega o aplicación completa confirmada, MTD puede
   registrar una sola vez el 100 % de la cuota.
5. **CA-05:** cualquier monto inferior, superior o proporcional se rechaza sin
   efectos parciales.
6. **CA-06:** dos solicitudes concurrentes para la misma autorización válida no
   producen dos recaudos; un número histórico con varias filas se bloquea sin
   crear eventos.
7. **CA-07:** repetir una solicitud idéntica con la misma clave idempotente no
   crea otro evento; reutilizarla con datos distintos produce conflicto.
8. **CA-08:** MEDICARTE puede consultar el estado dentro de su alcance, pero
   recibe denegación al intentar registrar o corregir.
9. **CA-09:** registrar, reintentar, rechazar o corregir un recaudo no cambia
   cantidades ni estados de inventario, reservas, entregas o aplicaciones.
10. **CA-10:** toda corrección conserva el evento original y registra actor,
    fecha, motivo, referencia y relación con el evento corregido.
11. **CA-11:** si un número histórico aparece asociado a varios productos, el
    sistema bloquea el recaudo con un código conciliable, sin escoger una fila.
12. **CA-12:** las pruebas distinguen atención confirmada y reserva activa,
    ausencia o liberación de reserva, historial ambiguo, anulación, concurrencia
    serializada y límites MTD/MEDICARTE.

## Referencias verificadas

- [AC-FIN-001 — Auditoría financiera de medicamentos de alto costo](AC-FIN-001-auditoria-financiera-alto-costo.md)
- [ADR-043 — Autorización, OC, recepción, cumplimiento y reasignación](../adr/043-authorization-order-receipt-fulfillment-reassignment.md)
- `apps/api/src/moderator-fee/authorization-moderator-fee.service.ts`
- `apps/api/src/moderator-fee/authorization-moderator-fee.controller.ts`
- `packages/contracts/src/moderator-fee.ts`
- `packages/database/src/schema.ts`
- `packages/database/migrations/0102_authorization_moderator_fee_events.sql`
- `packages/database/migrations/0103_mtd_moderator_fee_permission.sql`

## Decisión aprobada: autorización y recaudo único

### Unidad de autorización

- Cada autorización corresponde a un único producto.
- Una autorización puede contener N unidades de ese mismo producto.
- Las unidades pueden entregarse o aplicarse en varias atenciones.
- Cada autorización genera una única obligación de cuota moderadora.

### Regla de recaudo

- MTD recauda el 100 % de la cuota moderadora una sola vez por autorización.
- Si MEDICARTE entrega o aplica al menos una unidad, MTD puede recaudar la cuota completa.
- Las entregas o aplicaciones posteriores no generan nuevos cobros.
- También se permite recaudar antes de la primera atención si existe asignación y reserva activa verificable.
- Se prohíben los abonos, los cobros proporcionales y los cobros duplicados.

### Ejemplo

- Autorización: AUT-001.
- Producto: medicamento A.
- Cantidad autorizada: 4 unidades.
- Cuota moderadora: $18.000 COP.
- Primera atención: 1 unidad. Recaudo: $18.000 COP.
- Segunda atención: 2 unidades. Recaudo adicional: $0.
- Tercera atención: 1 unidad. Recaudo adicional: $0.

### Implicaciones para la implementación

- La unicidad financiera debe garantizarse por autorización.
- Debe comprobarse que la identidad técnica utilizada corresponde a esa autorización.
- No se debe confundir una atención parcial con una nueva obligación de pago.
- No se requiere compartir una cuota entre productos diferentes dentro de una misma autorización.

Esta decisión sustituye cualquier supuesto anterior de autorizaciones
multiproducto. Los datos históricos que contradigan la regla no se reinterpretan
automáticamente: se bloquean para conciliación.
