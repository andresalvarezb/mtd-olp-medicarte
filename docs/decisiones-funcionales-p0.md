# Registro de decisiones funcionales P0

**Alcance:** preparar la aprobación de RF-01 a RF-04 para AUD-P0-03. Este
registro no aprueba una regla ni agrega comportamiento al sistema. Las
alternativas son propuestas para decisión de MTD, OLP y Medicarte.

**Estado general:** pendiente de decisión funcional y firmas. No implementar
endpoints, contratos, jobs ni migraciones para estos flujos hasta completar la
decisión y revisión de integridad. Si un flujo no entra al release, registrar
su exclusión explícita, dueño y controles para evitar que se ejecute por vías
informales.

La evidencia de código actual está resumida en
[brechas funcionales priorizadas](casos-especiales/pendientes-funcionales-priorizados.md)
y en la [matriz de casos especiales](casos-especiales/matriz-pruebas-especiales.md).
La clasificación allí es lectura estática, no evidencia de UAT.

## Campos obligatorios para cada aprobación

- Decisión y versión de este registro; fecha efectiva y release al que aplica.
- Aprobador funcional designado por cada organización afectada: MTD, OLP y/o
  Medicarte. Identificar responsable operativo y responsable de inventario.
- Evento disparador, actor, estados permitidos, cantidades, lote, punto y
  documentos obligatorios.
- Efectos separados en OC, recepción/traslado, reservas, inventario y
  facturación/cuentas por pagar. No inferir asientos ni notas crédito de un
  movimiento físico.
- Permisos y alcance organizacional, concurrencia, idempotencia, auditoría,
  evidencia, reversión/compensación y visibilidad por actor.
- Casos positivos, negativos, repetidos y concurrentes; evidencia anonimizada
  asociada a un SHA y aprobación UAT.
- Decisión de alcance: implementar y certificar, o excluir expresamente del
  release con dueño y controles compensatorios.

## RF-01 — Devolución posrecepción a OLP

**Estado:** pendiente. Hoy se identificó rechazo durante recepción legacy; no
se da por verificado un flujo de devolución después de confirmar la recepción.

**Responsables de decisión:** Operaciones e Inventario de OLP; MTD debe aprobar
la contraparte de la orden; Medicarte aprueba su efecto en recepción/soporte
cuando corresponda. Arquitectura y Finanzas revisan integridad y facturación.

**Alternativas a decidir:**

1. Incorporar una devolución formal con autorización RMA, recepción del
   proveedor y movimientos compensatorios vinculados al movimiento original.
2. Admitir solo devolución parcial o total bajo condiciones y documentos que
   los responsables definan, manteniendo la orden y sus referencias históricas.
3. Excluir la devolución posrecepción del release; mantener el proceso vigente
   sin registrar una salida/entrada manual que simule el flujo.

**Efecto que debe aprobarse:**

- **Inventario:** qué lote y cantidad salen de OLP, qué estado físico se
  reconoce al retorno, quién confirma cada movimiento y cómo se impide devolver
  unidades ya consumidas, despachadas o asignadas a otra operación.
- **Facturación:** decidir por separado si existe nota crédito, ajuste de OC,
  reclamo a proveedor o efecto tributario; el movimiento físico por sí solo no
  debe cambiar facturas ni pagos.

**Controles y evidencia de aceptación:** RMA/documento asociado; permisos por
organización; cantidades acumuladas no mayores a lo recibido menos consumos;
idempotencia ante reintento; auditoría de actor, razón y enlaces; pruebas de
devolución parcial/total, duplicada, concurrencia con despacho/consumo y
rechazo por evidencia faltante; conciliación física y financiera aprobada por
OLP y MTD.

## RF-02 — Novedad durante traslado

**Estado:** pendiente. Existe el flujo base de transferencia
`CREATED → DISPATCHED → RECEIVED`; no se aprueba por ello un cierre parcial ni
la clasificación de faltantes o merma.

**Responsables de decisión:** responsables de despacho y recepción de MTD, OLP
y Medicarte según origen/destino; Inventario y Finanzas revisan cierres,
reclamos y efecto económico.

**Alternativas a decidir:**

1. Aceptar recepción parcial por cantidades verificadas y mantener la
   diferencia como incidencia abierta hasta reclamo o resolución documentada.
2. Mantener el traslado abierto hasta recepción total o resolución formal del
   faltante/merma, sin crear existencias en destino por unidades no recibidas.
3. Excluir novedades en tránsito del release y permitir únicamente la
   recepción completa ya soportada.

**Efecto que debe aprobarse:**

- **Inventario:** la salida del origen debe quedar ligada al traslado; el
  destino aumenta solo por unidades físicamente recibidas. Definir estado y
  ubicación de diferencia, daño, pérdida o rechazo, además de quién puede
  cerrar/reabrir el traslado.
- **Facturación:** decidir si la diferencia genera reclamo, ajuste del costo,
  cuenta por cobrar/pagar o ninguna consecuencia automática. No cerrar la
  orden ni cambiar valores contables solo por declarar una recepción parcial.

**Controles y evidencia de aceptación:** conteo por producto/lote/unidad;
soporte de despacho y recepción; conciliación `despachado = recibido +
pendiente/resuelto` con estados explícitos; separación de permisos origen y
destino; pruebas de recepción parcial, faltante, merma, duplicado, cierre con
diferencia y reintentos; acta de resolución y conciliación aprobada por ambas
partes.

## RF-03 — Reserva ante no-show o vencimiento

**Estado:** pendiente. La novedad `NOT_APPLIED` y el scheduler de vencimientos
no demuestran que una reserva física se libere automáticamente. No presumir
liberación, reutilización ni reasignación.

**Responsables de decisión:** Operaciones y responsable clínico/farmacéutico de
Medicarte; Inventario de la organización tenedora; MTD y OLP para la regla de
reasignación y su efecto comercial.

**Alternativas a decidir:**

1. Mantener reserva hasta revisión y liberación explícita por un actor
   autorizado, con evidencia de no atención y verificación del estado físico.
2. Permitir liberación automática solo después de una ventana y eventos que
   aprueben los responsables, dejando una cola de excepciones y una vía de
   bloqueo.
3. Excluir la liberación automática del release y conservar la reserva hasta
   cancelación/decisión manual conforme al proceso aprobado.

**Efecto que debe aprobarse:**

- **Inventario:** cuándo se libera la cantidad no consumida, lote y punto;
  quién confirma que la unidad sigue disponible y reutilizable; cómo se evita
  liberar lo aplicado, dispensado, vencido, separado o ya reasignado.
- **Facturación:** decidir si la no atención cambia facturación, copago,
  autorización o reclamación. La liberación de stock no debe borrar consumo,
  generar cobro ni reasignar automáticamente otra autorización sin regla
  expresa.

**Controles y evidencia de aceptación:** distinguir evento de consulta,
invalidación y movimiento real; reloj/zona horaria y ventana de espera
aprobados; locks e idempotencia; cantidades consumidas/retenidas/liberadas
reconciliadas; auditoría del motivo, actor y evidencia; pruebas límite de
horario, repetición, carreras con dispensación/aplicación y lote no reutilizable;
aprobación clínica, operativa e inventario.

## RF-04 — Ajuste manual por daño o vencimiento fuera de atención

**Estado:** pendiente. El movimiento `NON_REUSABLE` identificado en el código
pertenece al resultado de atención; no autoriza un ajuste manual independiente.

**Responsables de decisión:** responsable de inventario y control interno de la
organización tenedora; responsable clínico/farmacéutico cuando haya criterio de
seguridad; Finanzas/Contabilidad y contrapartes MTD/OLP/Medicarte por impacto
económico.

**Alternativas a decidir:**

1. Crear un ajuste formal con catálogo cerrado de motivos, soporte, doble
   aprobación y movimiento auditable no reutilizable.
2. Permitir solo cuarentena/bloqueo físico hasta inspección y aprobación; el
   egreso definitivo requiere una decisión posterior documentada.
3. Excluir el ajuste independiente del release y usar únicamente los procesos
   existentes que tengan controles y evidencia aprobados.

**Efecto que debe aprobarse:**

- **Inventario:** cantidad, lote, ubicación, motivo y estado resultante;
  impedir que el material bloqueado o descartado se asigne/dispense, sin
  alterar saldos por una nota libre o SQL manual.
- **Facturación:** decidir tratamiento de costo, proveedor, factura, seguro,
  impuesto y periodo contable por separado. El ajuste de unidades no debe
  generar una nota crédito, baja contable ni cargo al proveedor por inferencia.

**Controles y evidencia de aceptación:** doble aprobación independiente y
permisos segregados; soporte fechado (acta/foto/documento) sin datos clínicos
innecesarios; registro inmutable del antes/después; límite para evitar saldo
negativo y repetición; conciliación de ledger, existencias y documentos
financieros; pruebas de vencimiento, daño, reversión compensatoria, falta de
soporte, aprobador repetido y concurrencia con reserva/dispensación; firmas de
Inventario y Finanzas.

## Registro de aprobación

| RF    | Decisión aprobada o exclusión | MTD (nombre/fecha) | OLP (nombre/fecha) | Medicarte (nombre/fecha) | UAT / SHA | Estado  |
| ----- | ----------------------------- | ------------------ | ------------------ | ------------------------ | --------- | ------- |
| RF-01 | Pendiente                     | Pendiente          | Pendiente          | Pendiente                | Pendiente | ABIERTO |
| RF-02 | Pendiente                     | Pendiente          | Pendiente          | Pendiente                | Pendiente | ABIERTO |
| RF-03 | Pendiente                     | Pendiente          | Pendiente          | Pendiente                | Pendiente | ABIERTO |
| RF-04 | Pendiente                     | Pendiente          | Pendiente          | Pendiente                | Pendiente | ABIERTO |

Una firma de decisión no sustituye la implementación, pruebas ni UAT. AUD-P0-03
solo se cierra cuando cada RF se implementa y certifica, o queda excluida del
release con aprobación expresa y controles registrados.
